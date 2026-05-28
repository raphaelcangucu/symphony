defmodule SymphonyElixir.GitHub.IssueAdapter.Query do
  @moduledoc "GraphQL strings + normalizers for the GitHub Project v2 UI adapter."

  alias SymphonyElixir.Tracker.IssueDTO

  @list_items """
  query SymphonyUiListItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                id number title body url
                assignees(first: 1) { nodes { login } }
                labels(first: 20) { nodes { name } }
                createdAt updatedAt
              }
            }
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { id name } }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
  """

  @status_options """
  query SymphonyUiStatusOptions($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2SingleSelectField {
              id name
              options { id name }
            }
          }
        }
      }
    }
  }
  """

  @spec list_items_query() :: String.t()
  def list_items_query, do: @list_items

  @spec status_options_query() :: String.t()
  def status_options_query, do: @status_options

  @spec normalize_item(map(), String.t(), String.t()) :: IssueDTO.t() | nil
  def normalize_item(%{"content" => %{"__typename" => "Issue"} = content} = item, status_field, project_slug) do
    IssueDTO.build(%{
      id: content["id"],
      identifier: "#" <> to_string(content["number"]),
      title: content["title"],
      description: content["body"],
      url: content["url"],
      assignee: first_login(content),
      labels: label_names(content),
      status: status_from_field_values(item["fieldValues"], status_field),
      project_slug: project_slug,
      created_at: content["createdAt"],
      updated_at: content["updatedAt"]
    })
  end

  def normalize_item(_item, _status_field, _project_slug), do: nil

  @spec status_options(map()) :: [IssueDTO.status()]
  def status_options(%{"data" => %{"node" => %{"fields" => %{"nodes" => nodes}}}}) do
    nodes
    |> Enum.find(fn n -> n["__typename"] == "ProjectV2SingleSelectField" end)
    |> case do
      %{"options" => options} ->
        options
        |> Enum.with_index()
        |> Enum.map(fn {opt, idx} ->
          %{name: opt["name"], category: category_for(opt["name"]), position: idx, is_terminal: terminal?(opt["name"])}
        end)

      _ ->
        []
    end
  end

  def status_options(_), do: []

  @spec category_for(String.t()) :: String.t()
  def category_for(name) do
    cond do
      name in ["Backlog"] -> "backlog"
      name in ["In Progress", "In Review", "Human Review", "Merging", "Rework"] -> "started"
      name in ["Done", "Merged"] -> "completed"
      name in ["Cancelled", "Canceled", "Duplicate"] -> "canceled"
      true -> "unstarted"
    end
  end

  defp terminal?(name), do: category_for(name) in ["completed", "canceled"]

  defp first_login(%{"assignees" => %{"nodes" => [%{"login" => login} | _]}}), do: login
  defp first_login(_), do: nil

  defp label_names(%{"labels" => %{"nodes" => nodes}}), do: Enum.map(nodes, & &1["name"])
  defp label_names(_), do: []

  defp status_from_field_values(%{"nodes" => nodes}, status_field) do
    nodes
    |> Enum.find(fn n ->
      n["__typename"] == "ProjectV2ItemFieldSingleSelectValue" and
        get_in(n, ["field", "name"]) == status_field
    end)
    |> case do
      %{"name" => name} -> %{name: name, category: category_for(name), position: nil, is_terminal: terminal?(name)}
      _ -> nil
    end
  end

  defp status_from_field_values(_, _), do: nil
end
