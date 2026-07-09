defmodule SymphonyElixir.Codex.GoalControl do
  @moduledoc """
  Operator goal controls mapped onto the native Codex `thread/goal/*` API.

  The goal persisted in the Codex thread is the single source of truth. Symphony
  does not maintain a parallel goal abstraction and never synthesizes a goal from
  the issue's `agent_goal` column. Defining a goal (`set_objective/3`) ensures the
  issue workspace and a durable Codex thread exist, then sets the goal natively
  and persists the thread id as the issue's `agent_session_id`; all other controls
  operate on that native thread.

  Mapping of controls to native calls:

    * `pause/2`        → `thread/goal/set` with `status: "paused"`
    * `resume/2`       → `thread/goal/set` with `status: "active"`
    * `clear/2`        → `thread/goal/clear`
    * `set_objective/3`→ ensure thread + `thread/goal/set` with a new `objective`
    * `set_budget/3`   → `thread/goal/set` with `tokenBudget` (`nil` removes the budget)
    * `get/2`          → `thread/goal/get` (`{:ok, nil}` when no thread exists yet)
  """

  require Logger

  alias SymphonyElixir.Codex.CodingAgent
  alias SymphonyElixir.Codex.Session, as: CodexStore
  alias SymphonyElixir.{InstanceConfig, ProjectConfig, Repo, Workspace}
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Tracker.IssueAdapter

  @type goal_result :: {:ok, map() | nil | :cleared} | {:error, term()}

  @spec get(Project.t(), String.t()) :: goal_result()
  def get(%Project{} = project, identifier) when is_binary(identifier) do
    case with_goal(project, identifier, :get) do
      {:error, :no_codex_thread} -> {:ok, nil}
      other -> other
    end
  end

  @spec pause(Project.t(), String.t()) :: goal_result()
  def pause(%Project{} = project, identifier) when is_binary(identifier) do
    with_goal(project, identifier, {:set, %{status: "paused"}})
  end

  @spec resume(Project.t(), String.t()) :: goal_result()
  def resume(%Project{} = project, identifier) when is_binary(identifier) do
    with_goal(project, identifier, {:set, %{status: "active"}})
  end

  @spec clear(Project.t(), String.t()) :: goal_result()
  def clear(%Project{} = project, identifier) when is_binary(identifier) do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue_ref = issue_ref(project, issue)
      opts = goal_opts(project, issue_ref)

      native_result =
        if CodingAgent.goals_enabled?(opts) do
          CodingAgent.manage_goal(Workspace.path_for_issue(issue_ref), :clear, opts)
        else
          {:error, :goals_disabled}
        end

      case native_result do
        {:ok, :cleared} ->
          clear_persisted_goal_artifacts(project, identifier)
          {:ok, :cleared}

        {:error, :no_codex_thread} ->
          clear_persisted_goal_artifacts(project, identifier)
          {:ok, :cleared}

        # Goal mode may be disabled while a mirrored objective still exists in the
        # workspace sidecar (e.g. after handoff from the authoring assistant).
        # Clearing is always a local cleanup operation, not a goal-mode dispatch.
        {:error, :goals_disabled} ->
          clear_persisted_goal_artifacts(project, identifier)
          {:ok, :cleared}

        other ->
          other
      end
    end
  end

  @doc """
  Sets the goal objective, creating the issue workspace and a durable Codex
  thread first when none exists yet. Per the Codex contract this creates/replaces
  the native goal and resets native accounting. The resolved thread id is
  persisted as the issue's `agent_session_id`; no parallel objective is cached.
  """
  @spec set_objective(Project.t(), String.t(), String.t()) :: goal_result()
  def set_objective(%Project{} = project, identifier, objective)
      when is_binary(identifier) and is_binary(objective) do
    case String.trim(objective) do
      "" ->
        {:error, :empty_objective}

      trimmed ->
        ensure_native_goal(project, identifier, %{objective: trimmed, status: "active"})
    end
  end

  @doc """
  Sets or removes the goal token budget. Pass a positive integer to cap the
  budget, or `nil` to make the goal unlimited.
  """
  @spec set_budget(Project.t(), String.t(), pos_integer() | nil) :: goal_result()
  def set_budget(%Project{} = project, identifier, budget)
      when is_binary(identifier) and (is_nil(budget) or (is_integer(budget) and budget > 0)) do
    with_goal(project, identifier, {:set, %{token_budget: budget}})
  end

  # Operate on the issue's existing native Codex thread. Returns
  # `{:error, :no_codex_thread}` when the issue has no durable thread yet; the
  # public functions translate that into the right caller-facing result rather
  # than synthesizing a goal from any local cache.
  defp with_goal(%Project{} = project, identifier, command) do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue_ref = issue_ref(project, issue)
      workspace = Workspace.path_for_issue(issue_ref)
      CodingAgent.manage_goal(workspace, command, goal_opts(project, issue_ref))
    end
  end

  # Ensure the issue workspace and a durable Codex thread exist, set the goal
  # natively, and persist the thread id as the issue's `agent_session_id`. The
  # goals-enabled gate runs before any workspace creation so a disabled project
  # is a clean no-op with no filesystem side effects.
  defp ensure_native_goal(%Project{} = project, identifier, attrs) do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue_ref = issue_ref(project, issue)
      opts = goal_opts(project, issue_ref)

      if CodingAgent.goals_enabled?(opts) do
        with {:ok, workspace} <- Workspace.create_for_issue(issue_ref),
             {:ok, %{goal: goal, thread_id: thread_id}} <-
               CodingAgent.ensure_goal(workspace, attrs, opts) do
          persist_session_id(project, identifier, thread_id)
          {:ok, goal}
        end
      else
        {:error, :goals_disabled}
      end
    end
  end

  defp persist_session_id(%Project{} = project, identifier, thread_id)
       when is_binary(thread_id) and thread_id != "" do
    Context.set_agent_session_id(project.slug, identifier, thread_id)
    :ok
  rescue
    error ->
      Logger.debug("Skipping agent_session_id persistence identifier=#{identifier} reason=#{inspect(error)}")
      :ok
  end

  defp persist_session_id(_project, _identifier, _thread_id), do: :ok

  defp goal_opts(%Project{} = project, issue_ref) do
    config = project |> Repo.preload(:setup) |> ProjectConfig.resolve()

    [
      workspace_root: Workspace.workspace_root_for(issue_ref),
      codex_config: codex_config(config)
    ]
  end

  defp codex_config(%ProjectConfig{codex: codex}) when is_map(codex) do
    InstanceConfig.merge_codex_section(codex)
  end

  defp codex_config(_config), do: InstanceConfig.codex_section()

  defp issue_ref(%Project{} = project, issue) do
    %{
      id: Map.get(issue, :id),
      identifier: Map.get(issue, :identifier),
      project_slug: Map.get(issue, :project_slug) || project.slug
    }
  end

  # Drop any legacy `agent_goal` value and the workspace goal mirror when a Codex
  # goal is cleared so a stale objective cannot resurface in execution surfaces.
  # The Codex thread is the source of truth when goal mode is enabled; when it is
  # not, local artifacts are all that remain to wipe.
  defp clear_persisted_goal_artifacts(%Project{} = project, identifier) do
    clear_cached_objective(project, identifier)
    clear_mirrored_goal(project, identifier)
    :ok
  end

  defp clear_cached_objective(%Project{} = project, identifier) do
    Context.set_agent_goal(project.slug, identifier, nil)
    :ok
  rescue
    error ->
      Logger.debug("Skipping agent_goal clear identifier=#{identifier} reason=#{inspect(error)}")
      :ok
  end

  defp clear_mirrored_goal(%Project{} = project, identifier) do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue_ref = issue_ref(project, issue)
      CodexStore.put_goal(Workspace.path_for_issue(issue_ref), nil)
    else
      _ -> :ok
    end
  rescue
    error ->
      Logger.debug("Skipping goal mirror clear identifier=#{identifier} reason=#{inspect(error)}")
      :ok
  end
end
