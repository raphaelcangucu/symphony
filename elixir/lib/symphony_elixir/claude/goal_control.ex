defmodule SymphonyElixir.Claude.GoalControl do
  @moduledoc """
  Claude Code `/goal` controls mirrored in workspace sidecars.

  Symphony does not reimplement Claude's evaluator. It queues a pending
  `set` / `clear` command that `Claude.CodingAgent` injects as a `/goal …`
  or `/goal clear` prompt prefix on the next CLI turn.
  """

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
    with :ok <- ensure_supported(),
         {:ok, workspace} <- ensure_workspace(project, identifier),
         :ok <-
           GoalStore.put(workspace, :execution, %{
             "status" => "active",
             "objective" => objective,
             "pending_command" => "set"
           }),
         :ok <- maybe_mirror_agent_goal(project, identifier, :execution, String.trim(objective)),
         {:ok, goal} <- GoalStore.read(workspace, :execution) do
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
          :ok = maybe_clear_agent_goal(project, identifier, :execution)
          {:ok, :cleared}

        {:ok, %{"status" => "cleared"}} ->
          :ok = maybe_clear_agent_goal(project, identifier, :execution)
          {:ok, :cleared}

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
          :ok | {:error, term()}
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
    case pending_with_revision(workspace, role, assistant_thread_id) do
      {:inject, :set, objective, revision} ->
        {"/goal #{objective}\n\n" <> prompt, {:set, revision}}

      {:inject, :clear, revision} ->
        {"/goal clear\n\n" <> prompt, {:clear, revision}}

      :none ->
        {prompt, :none}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp pending_with_revision(workspace, role, assistant_thread_id) do
    case GoalStore.read(workspace, role, assistant_thread_id) do
      {:ok, %{"pending_command" => "set", "objective" => objective, "revision" => revision}}
      when is_binary(objective) and objective != "" and is_binary(revision) ->
        {:inject, :set, objective, revision}

      {:ok, %{"pending_command" => "clear", "revision" => revision}} when is_binary(revision) ->
        {:inject, :clear, revision}

      {:error, reason} ->
        {:error, reason}

      _ ->
        :none
    end
  end

  defp ensure_supported do
    if AgentAvailability.claude_goal_supported?() do
      :ok
    else
      {:error, :claude_goal_unsupported_version}
    end
  end

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

  defp maybe_mirror_agent_goal(project, identifier, :execution, objective) do
    case Context.set_agent_goal(project.slug, identifier, objective) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp maybe_clear_agent_goal(project, identifier, :execution) do
    case Context.set_agent_goal(project.slug, identifier, nil) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end
