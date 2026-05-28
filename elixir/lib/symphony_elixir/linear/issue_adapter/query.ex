defmodule SymphonyElixir.Linear.IssueAdapter.Query do
  @moduledoc "GraphQL strings + normalizers for the Linear project UI adapter."

  alias SymphonyElixir.Tracker.IssueDTO

  @list_issues """
  query SymphonyUiLinearIssues($projectId: String!) {
    project(id: $projectId) {
      id
      issues(first: 100) {
        nodes {
          id identifier title description priority url
          state { id name type position }
          assignee { displayName }
          creator { displayName }
          createdAt updatedAt
        }
      }
    }
  }
  """

  @team_states """
  query SymphonyUiLinearStates($projectId: String!) {
    project(id: $projectId) {
      id
      teams(first: 1) {
        nodes {
          id
          states(first: 50) { nodes { id name type position } }
        }
      }
    }
  }
  """

  @spec list_issues_query() :: String.t()
  def list_issues_query, do: @list_issues

  @spec team_states_query() :: String.t()
  def team_states_query, do: @team_states

  @spec normalize_issue(map(), String.t()) :: IssueDTO.t()
  def normalize_issue(node, project_slug) do
    IssueDTO.build(%{
      id: node["id"],
      identifier: node["identifier"],
      title: node["title"],
      description: node["description"],
      priority: node["priority"],
      url: node["url"],
      assignee: get_in(node, ["assignee", "displayName"]),
      creator: get_in(node, ["creator", "displayName"]),
      status: state_to_status(node["state"]),
      project_slug: project_slug,
      created_at: node["createdAt"],
      updated_at: node["updatedAt"]
    })
  end

  @spec team_states(map()) :: [IssueDTO.status()]
  def team_states(%{"data" => %{"project" => %{"teams" => %{"nodes" => [team | _]}}}}) do
    team
    |> get_in(["states", "nodes"])
    |> List.wrap()
    |> Enum.sort_by(& &1["position"])
    |> Enum.map(&state_to_status/1)
  end

  def team_states(_), do: []

  @spec category_for(String.t()) :: String.t()
  def category_for(type) do
    case type do
      "started" -> "started"
      "completed" -> "completed"
      "canceled" -> "canceled"
      "backlog" -> "backlog"
      _ -> "unstarted"
    end
  end

  defp state_to_status(nil), do: nil

  defp state_to_status(%{"name" => name, "type" => type} = state) do
    %{name: name, category: category_for(type), position: trunc_position(state["position"]), is_terminal: type in ["completed", "canceled"]}
  end

  defp trunc_position(p) when is_number(p), do: trunc(p)
  defp trunc_position(_), do: nil
end
