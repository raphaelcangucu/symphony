defmodule SymphonyElixir.Claude.GoalControl do
  @moduledoc """
  Claude Code `/goal` controls mirrored in workspace sidecars.

  Symphony does not reimplement Claude's evaluator. It queues a pending
  `set` / `clear` command that `Claude.CodingAgent` injects as a `/goal …`
  or `/goal clear` prompt prefix on the next CLI turn.
  """

  require Logger

  alias SymphonyElixir.AgentAvailability
  alias SymphonyElixir.Claude.GoalStore
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Workspace

  @type role :: :execution | :authoring
  @type goal_result :: {:ok, map() | nil | :cleared} | {:error, term()}

  @spec get(Project.t(), String.t(), role()) :: goal_result()
  def get(%Project{} = project, identifier, :execution) when is_binary(identifier) do
    with {:ok, workspace} <- workspace_for(project, identifier) do
      case GoalStore.read(workspace, :execution) do
        {:ok, goal} -> {:ok, goal}
        :error -> {:ok, nil}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  def get(%Project{}, identifier, :authoring) when is_binary(identifier),
    do: {:error, :assistant_thread_id_required}

  @spec set_objective(Project.t(), String.t(), role(), String.t()) :: goal_result()
  def set_objective(%Project{} = project, identifier, :execution, objective)
      when is_binary(identifier) and is_binary(objective) do
    with {:ok, workspace} <- ensure_workspace(project, identifier),
         :ok <- ensure_supported(workspace),
         :ok <-
           GoalStore.put(workspace, :execution, %{
             "status" => "active",
             "objective" => objective,
             "pending_command" => "set"
           }),
         {:ok, goal} <- GoalStore.read(workspace, :execution) do
      mirror_agent_goal_best_effort(project, identifier, String.trim(objective))
      {:ok, goal}
    else
      :error -> {:error, :goal_store_read_failed}
      {:error, reason} -> {:error, reason}
    end
  end

  def set_objective(%Project{}, identifier, :authoring, objective)
      when is_binary(identifier) and is_binary(objective),
      do: {:error, :assistant_thread_id_required}

  @spec clear(Project.t(), String.t(), role()) :: goal_result()
  def clear(%Project{} = project, identifier, :execution) when is_binary(identifier) do
    with {:ok, workspace} <- ensure_workspace(project, identifier) do
      case GoalStore.read(workspace, :execution) do
        :error ->
          with :ok <- maybe_clear_agent_goal(project, identifier, :execution) do
            {:ok, :cleared}
          end

        {:ok, %{"status" => "completed", "objective" => nil}} ->
          with :ok <- maybe_clear_agent_goal(project, identifier, :execution) do
            {:ok, :cleared}
          end

        {:ok, goal} ->
          case GoalStore.put(workspace, :execution, %{
                 "status" => Map.get(goal, "status") || "active",
                 "objective" => Map.get(goal, "objective"),
                 "pending_command" => "clear",
                 "cli_session_id" => Map.get(goal, "cli_session_id")
               }) do
            :ok -> GoalStore.read(workspace, :execution)
            {:error, reason} -> {:error, reason}
          end

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  def clear(%Project{}, identifier, :authoring) when is_binary(identifier),
    do: {:error, :assistant_thread_id_required}

  @spec pause(Project.t(), String.t(), role()) :: {:error, term()}
  def pause(%Project{}, identifier, :execution)
      when is_binary(identifier),
      do: {:error, :unsupported_for_agent}

  def pause(%Project{}, identifier, :authoring) when is_binary(identifier),
    do: {:error, :assistant_thread_id_required}

  @spec resume(Project.t(), String.t(), role()) :: {:error, term()}
  def resume(%Project{}, identifier, :execution)
      when is_binary(identifier),
      do: {:error, :unsupported_for_agent}

  def resume(%Project{}, identifier, :authoring) when is_binary(identifier),
    do: {:error, :assistant_thread_id_required}

  @spec set_budget(Project.t(), String.t(), role(), pos_integer() | nil) :: {:error, term()}
  def set_budget(%Project{}, identifier, :execution, _budget)
      when is_binary(identifier),
      do: {:error, :unsupported_for_agent}

  def set_budget(%Project{}, identifier, :authoring, _budget) when is_binary(identifier),
    do: {:error, :assistant_thread_id_required}

  @spec consume_pending(Path.t(), role()) ::
          {:inject, :set, String.t()} | {:inject, :clear} | :none | {:error, term()}
  def consume_pending(workspace, role)
      when is_binary(workspace) and role == :execution do
    consume_pending(workspace, role, nil)
  end

  def consume_pending(workspace, :authoring) when is_binary(workspace),
    do: raise_thread_id_required!()

  @spec consume_pending(Path.t(), role(), integer() | nil) ::
          {:inject, :set, String.t()} | {:inject, :clear} | :none | {:error, term()}
  def consume_pending(workspace, role, assistant_thread_id)
      when is_binary(workspace) and role in [:execution, :authoring] do
    case GoalStore.read(workspace, role, assistant_thread_id) do
      {:ok, %{"pending_command" => "set", "objective" => objective}}
      when is_binary(objective) and objective != "" ->
        {:inject, :set, objective}

      {:ok, %{"pending_command" => "clear"}} ->
        {:inject, :clear}

      {:error, reason} ->
        {:error, reason}

      _ ->
        :none
    end
  end

  @spec acknowledge_inject(Path.t(), role(), {:set | :clear, String.t()}, integer() | nil) ::
          :ok | :stale | {:error, term()}
  def acknowledge_inject(workspace, role, {command, revision}, assistant_thread_id)
      when is_binary(workspace) and role in [:execution, :authoring] and
             command in [:set, :clear] and is_binary(revision) do
    GoalStore.acknowledge_pending(workspace, role, command, revision, assistant_thread_id)
  end

  @spec requeue_set_if_active(Path.t(), role()) :: :ok | {:error, term()}
  def requeue_set_if_active(workspace, role)
      when is_binary(workspace) and role == :execution do
    requeue_set_if_active(workspace, role, nil)
  end

  def requeue_set_if_active(workspace, :authoring) when is_binary(workspace),
    do: raise_thread_id_required!()

  @spec requeue_set_if_active(Path.t(), role(), integer() | nil) :: :ok | {:error, term()}
  def requeue_set_if_active(workspace, role, assistant_thread_id)
      when is_binary(workspace) and role in [:execution, :authoring] do
    GoalStore.requeue_set_if_active(workspace, role, assistant_thread_id)
  end

  @spec apply_pending_to_prompt(String.t(), Path.t(), role()) ::
          {String.t(), term()} | {:error, term()}
  def apply_pending_to_prompt(prompt, workspace, role)
      when is_binary(prompt) and is_binary(workspace) and role == :execution do
    apply_pending_to_prompt(prompt, workspace, role, nil)
  end

  def apply_pending_to_prompt(prompt, workspace, :authoring)
      when is_binary(prompt) and is_binary(workspace),
      do: raise_thread_id_required!()

  @spec apply_pending_to_prompt(String.t(), Path.t(), role(), integer() | nil) ::
          {String.t(), term()} | {:error, term()}
  def apply_pending_to_prompt(prompt, workspace, role, assistant_thread_id)
      when is_binary(prompt) and is_binary(workspace) and role in [:execution, :authoring] do
    case GoalStore.read(workspace, role, assistant_thread_id) do
      {:ok, goal} ->
        apply_snapshot_to_prompt(prompt, goal)

      :error ->
        apply_snapshot_to_prompt(prompt, nil)

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "Applies a previously-read, revision-bearing goal snapshot to a CLI prompt."
  @spec apply_snapshot_to_prompt(String.t(), map() | nil) ::
          {String.t(), {:set | :clear, String.t()} | :none} | {:error, term()}
  def apply_snapshot_to_prompt(prompt, snapshot) when is_binary(prompt) do
    case snapshot do
      %{"pending_command" => "set", "objective" => objective, "revision" => revision}
      when is_binary(objective) and objective != "" and is_binary(revision) and revision != "" ->
        {"/goal #{objective}\n\n" <> prompt, {:set, revision}}

      %{"pending_command" => "clear", "revision" => revision}
      when is_binary(revision) and revision != "" ->
        {"/goal clear\n\n" <> prompt, {:clear, revision}}

      %{"pending_command" => nil, "revision" => revision}
      when is_binary(revision) and revision != "" ->
        {prompt, :none}

      nil ->
        {prompt, :none}

      _ ->
        {:error, :goal_revision_required}
    end
  end

  @doc "Clears the issue-level objective mirror after native execution-goal clear."
  @spec clear_tracker_mirror(map()) :: :ok | {:error, term()}
  def clear_tracker_mirror(%{project_slug: project_slug, identifier: identifier})
      when is_binary(project_slug) and is_binary(identifier) do
    set_tracker_mirror(project_slug, identifier, nil)
  end

  def clear_tracker_mirror(_issue), do: {:error, :issue_context_required}

  @doc "Revision-safely acknowledges native clear and clears its tracker mirror."
  @spec acknowledge_clear_and_mirror(Path.t(), String.t(), integer() | nil, map()) ::
          :ok | :stale | {:error, term()}
  def acknowledge_clear_and_mirror(workspace, revision, assistant_thread_id, issue)
      when is_binary(workspace) and is_binary(revision) do
    with {:ok, project_slug, identifier} <- tracker_coordinates(issue) do
      GoalStore.acknowledge_clear_with_mirror(
        workspace,
        :execution,
        revision,
        assistant_thread_id,
        fn -> set_tracker_mirror(project_slug, identifier, nil) end,
        fn newer_goal ->
          set_tracker_mirror(project_slug, identifier, Map.get(newer_goal, "objective"))
        end
      )
    end
  end

  defp tracker_coordinates(%{project_slug: project_slug, identifier: identifier})
       when is_binary(project_slug) and is_binary(identifier),
       do: {:ok, project_slug, identifier}

  defp tracker_coordinates(_issue), do: {:error, :issue_context_required}

  defp set_tracker_mirror(project_slug, identifier, objective) do
    case Context.set_agent_goal(project_slug, identifier, objective) do
      {:ok, _issue} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_supported(workspace),
    do: AgentAvailability.claude_goal_preflight(workspace)

  defp raise_thread_id_required! do
    raise ArgumentError, "assistant_thread_id is required for Claude authoring goal control"
  end

  defp ensure_workspace(%Project{} = project, identifier) do
    with {:ok, workspace} <- workspace_for(project, identifier) do
      File.mkdir_p!(workspace)
      {:ok, workspace}
    end
  end

  defp workspace_for(%Project{} = project, identifier) do
    case Context.get_issue(project.slug, identifier) do
      {:ok, issue} ->
        issue_ref = %{id: issue.id, identifier: issue.identifier, project_slug: project.slug}
        {:ok, Workspace.path_for_issue(issue_ref)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp mirror_agent_goal_best_effort(project, identifier, objective) do
    try do
      case Context.set_agent_goal(project.slug, identifier, objective) do
        {:ok, _} ->
          :ok

        {:error, reason} ->
          log_mirror_failure(project, identifier, :returned_error, reason, [])

        unexpected ->
          log_mirror_failure(project, identifier, :unexpected_return, unexpected, [])
      end
    rescue
      exception ->
        log_mirror_failure(project, identifier, :error, exception, __STACKTRACE__)
    catch
      kind, reason ->
        log_mirror_failure(project, identifier, kind, reason, __STACKTRACE__)
    end

    :ok
  end

  defp log_mirror_failure(project, identifier, kind, reason, stacktrace) do
    try do
      detail =
        if kind in [:error, :exit, :throw],
          do: Exception.format(kind, reason, stacktrace),
          else: inspect(reason)

      Logger.warning(
        "Claude goal sidecar persisted but tracker mirror update failed " <>
          "project_slug=#{project.slug} issue_identifier=#{identifier} " <>
          "failure_kind=#{kind} reason=#{detail}"
      )
    rescue
      _exception -> :ok
    catch
      _kind, _reason -> :ok
    end

    :ok
  end

  defp maybe_clear_agent_goal(project, identifier, :execution) do
    case Context.set_agent_goal(project.slug, identifier, nil) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end
