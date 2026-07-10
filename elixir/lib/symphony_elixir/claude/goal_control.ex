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
  def get(%Project{} = project, identifier, role)
      when is_binary(identifier) and role in [:execution, :authoring] do
    with {:ok, workspace} <- workspace_for(project, identifier) do
      case GoalStore.read(workspace, role) do
        {:ok, goal} -> {:ok, goal}
        :error -> {:ok, nil}
      end
    end
  end

  @spec set_objective(Project.t(), String.t(), role(), String.t()) :: goal_result()
  def set_objective(%Project{} = project, identifier, role, objective)
      when is_binary(identifier) and role in [:execution, :authoring] and is_binary(objective) do
    with :ok <- ensure_supported(),
         {:ok, workspace} <- ensure_workspace(project, identifier),
         :ok <-
           GoalStore.put(workspace, role, %{
             "status" => "active",
             "objective" => objective,
             "pending_command" => "set"
           }),
         :ok <- maybe_mirror_agent_goal(project, identifier, role, String.trim(objective)),
         {:ok, goal} <- GoalStore.read(workspace, role) do
      {:ok, goal}
    else
      :error -> {:error, :goal_store_read_failed}
      {:error, reason} -> {:error, reason}
    end
  end

  @spec clear(Project.t(), String.t(), role()) :: goal_result()
  def clear(%Project{} = project, identifier, role)
      when is_binary(identifier) and role in [:execution, :authoring] do
    with {:ok, workspace} <- ensure_workspace(project, identifier) do
      case GoalStore.read(workspace, role) do
        :error ->
          :ok = maybe_clear_agent_goal(project, identifier, role)
          {:ok, :cleared}

        {:ok, %{"status" => "cleared"}} ->
          :ok = maybe_clear_agent_goal(project, identifier, role)
          {:ok, :cleared}

        {:ok, goal} ->
          case GoalStore.put(workspace, role, %{
                 "status" => Map.get(goal, "status") || "active",
                 "objective" => Map.get(goal, "objective"),
                 "pending_command" => "clear",
                 "cli_session_id" => Map.get(goal, "cli_session_id")
               }) do
            :ok -> GoalStore.read(workspace, role)
            {:error, reason} -> {:error, reason}
          end
      end
    end
  end

  @spec pause(Project.t(), String.t(), role()) :: {:error, :unsupported_for_agent}
  def pause(%Project{}, identifier, role)
      when is_binary(identifier) and role in [:execution, :authoring],
      do: {:error, :unsupported_for_agent}

  @spec resume(Project.t(), String.t(), role()) :: {:error, :unsupported_for_agent}
  def resume(%Project{}, identifier, role)
      when is_binary(identifier) and role in [:execution, :authoring],
      do: {:error, :unsupported_for_agent}

  @spec set_budget(Project.t(), String.t(), role(), pos_integer() | nil) ::
          {:error, :unsupported_for_agent}
  def set_budget(%Project{}, identifier, role, _budget)
      when is_binary(identifier) and role in [:execution, :authoring],
      do: {:error, :unsupported_for_agent}

  @spec consume_pending(Path.t(), role()) ::
          {:inject, :set, String.t()} | {:inject, :clear} | :none
  def consume_pending(workspace, role)
      when is_binary(workspace) and role in [:execution, :authoring] do
    case GoalStore.read(workspace, role) do
      {:ok, %{"pending_command" => "set", "objective" => objective}}
      when is_binary(objective) and objective != "" ->
        {:inject, :set, objective}

      {:ok, %{"pending_command" => "clear"}} ->
        {:inject, :clear}

      _ ->
        :none
    end
  end

  @spec acknowledge_inject(Path.t(), role(), :set | :clear) :: :ok | {:error, term()}
  def acknowledge_inject(workspace, role, :set)
      when is_binary(workspace) and role in [:execution, :authoring] do
    GoalStore.clear_pending(workspace, role)
  end

  def acknowledge_inject(workspace, role, :clear)
      when is_binary(workspace) and role in [:execution, :authoring] do
    GoalStore.mark_cleared(workspace, role)
  end

  @spec requeue_set_if_active(Path.t(), role()) :: :ok | {:error, term()}
  def requeue_set_if_active(workspace, role)
      when is_binary(workspace) and role in [:execution, :authoring] do
    case GoalStore.read(workspace, role) do
      {:ok, %{"status" => "active", "objective" => objective} = goal}
      when is_binary(objective) and objective != "" ->
        GoalStore.put(workspace, role, Map.put(goal, "pending_command", "set"))

      _ ->
        :ok
    end
  end

  @spec apply_pending_to_prompt(String.t(), Path.t(), role()) ::
          {String.t(), :set | :clear | :none}
  def apply_pending_to_prompt(prompt, workspace, role)
      when is_binary(prompt) and is_binary(workspace) and role in [:execution, :authoring] do
    case consume_pending(workspace, role) do
      {:inject, :set, objective} ->
        {"/goal #{objective}\n\n" <> prompt, :set}

      {:inject, :clear} ->
        {"/goal clear\n\n" <> prompt, :clear}

      :none ->
        {prompt, :none}
    end
  end

  defp ensure_supported do
    if AgentAvailability.claude_goal_supported?() do
      :ok
    else
      {:error, :claude_goal_unsupported_version}
    end
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

  defp maybe_mirror_agent_goal(_project, _identifier, :authoring, _objective), do: :ok

  defp maybe_clear_agent_goal(project, identifier, :execution) do
    case Context.set_agent_goal(project.slug, identifier, nil) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp maybe_clear_agent_goal(_project, _identifier, :authoring), do: :ok
end
