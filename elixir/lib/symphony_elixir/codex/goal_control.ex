defmodule SymphonyElixir.Codex.GoalControl do
  @moduledoc """
  Operator goal controls mapped onto the native Codex `thread/goal/*` API.

  Every control resolves the issue's workspace and project Codex config, then
  drives `SymphonyElixir.Codex.CodingAgent.manage_goal/3`. The goal persisted in
  the Codex thread stays the single source of truth — Symphony does not maintain
  a parallel goal abstraction. The issue's `agent_goal` field is treated only as
  a cached objective for display, so it is mirrored on edit/clear but never used
  as operational state.

  Mapping of controls to native calls:

    * `pause/2`        → `thread/goal/set` with `status: "paused"`
    * `resume/2`       → `thread/goal/set` with `status: "active"`
    * `clear/2`        → `thread/goal/clear` (+ clears the cached objective)
    * `set_objective/3`→ `thread/goal/set` with a new `objective` (resets native accounting)
    * `set_budget/3`   → `thread/goal/set` with `tokenBudget` (`nil` removes the budget)
    * `get/2`          → `thread/goal/get`
  """

  require Logger

  alias SymphonyElixir.Codex.CodingAgent
  alias SymphonyElixir.{InstanceConfig, ProjectConfig, Repo, Workspace}
  alias SymphonyElixir.LocalTracker.{Context, Project}
  alias SymphonyElixir.Tracker.IssueAdapter

  @type goal_result :: {:ok, map() | nil | :cleared} | {:error, term()}

  @spec get(Project.t(), String.t()) :: goal_result()
  def get(%Project{} = project, identifier) when is_binary(identifier) do
    with_goal(project, identifier, :get)
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
    case with_goal(project, identifier, :clear) do
      {:ok, :cleared} = ok ->
        cache_objective(project, identifier, nil)
        ok

      other ->
        other
    end
  end

  @doc """
  Replaces the goal objective. Per the Codex contract this creates a new goal and
  resets native accounting; the cached objective is updated to match.
  """
  @spec set_objective(Project.t(), String.t(), String.t()) :: goal_result()
  def set_objective(%Project{} = project, identifier, objective)
      when is_binary(identifier) and is_binary(objective) do
    case String.trim(objective) do
      "" ->
        {:error, :empty_objective}

      trimmed ->
        case with_goal(project, identifier, {:set, %{objective: trimmed, status: "active"}}) do
          {:ok, _goal} = ok ->
            cache_objective(project, identifier, trimmed)
            ok

          other ->
            other
        end
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

  defp with_goal(%Project{} = project, identifier, command) do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [identifier]) do
      issue_ref = issue_ref(project, issue)
      workspace = Workspace.path_for_issue(issue_ref)
      CodingAgent.manage_goal(workspace, command, goal_opts(project, issue_ref))
    end
  end

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

  defp cache_objective(%Project{} = project, identifier, objective) do
    Context.set_agent_goal(project.slug, identifier, objective)
    :ok
  rescue
    error ->
      Logger.debug("Skipping agent_goal cache update identifier=#{identifier} reason=#{inspect(error)}")
      :ok
  end
end
