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
          assignee { id displayName }
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

  @team_labels """
  query SymphonyUiLinearLabels($projectId: String!) {
    project(id: $projectId) {
      id
      teams(first: 1) {
        nodes {
          id
          labels(first: 100) { nodes { id name color } }
        }
      }
    }
  }
  """

  @team_members """
  query SymphonyUiLinearMembers($projectId: String!) {
    project(id: $projectId) {
      id
      teams(first: 1) {
        nodes {
          id
          members(first: 100) { nodes { id name displayName avatarUrl } }
        }
      }
    }
  }
  """

  @create_issue """
  mutation SymphonyUiLinearCreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id identifier title url
        state { id name type position }
      }
    }
  }
  """

  @spec list_issues_query() :: String.t()
  def list_issues_query, do: @list_issues

  @spec team_states_query() :: String.t()
  def team_states_query, do: @team_states

  @spec team_labels_query() :: String.t()
  def team_labels_query, do: @team_labels

  @spec team_members_query() :: String.t()
  def team_members_query, do: @team_members

  @spec create_issue_mutation() :: String.t()
  def create_issue_mutation, do: @create_issue

  @spec team_labels(map()) :: [map()]
  def team_labels(%{"data" => %{"project" => %{"teams" => %{"nodes" => [team | _]}}}}) do
    team
    |> get_in(["labels", "nodes"])
    |> List.wrap()
    |> Enum.map(fn node -> %{id: node["id"], name: node["name"], color: node["color"]} end)
  end

  def team_labels(_), do: []

  @spec team_members(map()) :: [map()]
  def team_members(%{"data" => %{"project" => %{"teams" => %{"nodes" => [team | _]}}}}) do
    team
    |> get_in(["members", "nodes"])
    |> List.wrap()
    |> Enum.map(fn node ->
      %{
        id: node["id"],
        login: node["displayName"] || node["name"],
        name: node["name"],
        avatar_url: node["avatarUrl"]
      }
    end)
  end

  def team_members(_), do: []

  @spec team_id(map()) :: {:ok, String.t()} | {:error, :team_not_found}
  def team_id(%{"data" => %{"project" => %{"teams" => %{"nodes" => [%{"id" => id} | _]}}}})
      when is_binary(id) do
    {:ok, id}
  end

  def team_id(_), do: {:error, :team_not_found}

  @spec state_id(map(), String.t() | nil) ::
          {:ok, String.t() | nil} | {:error, :status_not_found}
  def state_id(_response, status) when status in [nil, ""], do: {:ok, nil}

  def state_id(%{"data" => %{"project" => %{"teams" => %{"nodes" => [team | _]}}}}, status) do
    team
    |> get_in(["states", "nodes"])
    |> List.wrap()
    |> Enum.find(fn state -> state["name"] == status end)
    |> case do
      %{"id" => id} when is_binary(id) -> {:ok, id}
      _ -> {:error, :status_not_found}
    end
  end

  def state_id(_response, _status), do: {:error, :status_not_found}

  @spec created_issue(map(), String.t()) :: {:ok, IssueDTO.t()} | {:error, :create_failed}
  def created_issue(%{"data" => %{"issueCreate" => %{"issue" => %{"id" => _} = issue}}}, project_slug) do
    {:ok, normalize_issue(issue, project_slug)}
  end

  def created_issue(_response, _project_slug), do: {:error, :create_failed}

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
      assignee_remote_id: get_in(node, ["assignee", "id"]),
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
