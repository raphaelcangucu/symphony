defmodule SymphonyElixir.GitHub.IssueAdapter.Query do
  @moduledoc "GraphQL strings + normalizers for the GitHub Project v2 UI adapter."

  alias SymphonyElixir.Tracker.IssueDTO

  @list_items """
  query SymphonyUiListItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after, orderBy: {field: POSITION, direction: ASC}) {
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

  @update_field_value """
  mutation SymphonyUiSetStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
  """

  @repo_metadata """
  query SymphonyUiRepoMetadata($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      labels(first: 100) { nodes { id name color } }
    }
  }
  """

  @assignable_users """
  query SymphonyUiAssignableUsers($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      assignableUsers(first: 100) { nodes { id login name avatarUrl } }
    }
  }
  """

  @create_issue """
  mutation SymphonyUiCreateIssue($input: CreateIssueInput!) {
    createIssue(input: $input) {
      issue { id number url title }
    }
  }
  """

  @add_project_item """
  mutation SymphonyUiAddProjectItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
  """

  @issue_node_id """
  query SymphonyUiIssueNodeId($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id
        title
        body
        labels(first: 50) { nodes { id name } }
      }
    }
  }
  """

  @update_issue """
  mutation SymphonyUiUpdateIssue($input: UpdateIssueInput!) {
    updateIssue(input: $input) {
      issue { id number title body url updatedAt }
    }
  }
  """

  @add_labels """
  mutation SymphonyUiAddLabels($labelableId: ID!, $labelIds: [ID!]!) {
    addLabelsToLabelable(input: { labelableId: $labelableId, labelIds: $labelIds }) {
      labelable { __typename }
    }
  }
  """

  @resolve_project_item """
  query SymphonyUiResolveProjectItem($issueId: ID!, $first: Int!) {
    node(id: $issueId) {
      ... on Issue {
        projectItems(first: $first) {
          nodes {
            id
            project { id }
          }
        }
      }
    }
  }
  """

  @archive_project_item """
  mutation SymphonyUiArchiveProjectItem($projectId: ID!, $itemId: ID!) {
    archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      item { id }
    }
  }
  """

  @unarchive_project_item """
  mutation SymphonyUiUnarchiveProjectItem($projectId: ID!, $itemId: ID!) {
    unarchiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      item { id }
    }
  }
  """

  @delete_project_item """
  mutation SymphonyUiDeleteProjectItem($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      deletedItemId
    }
  }
  """

  @spec list_items_query() :: String.t()
  def list_items_query, do: @list_items

  @spec archive_project_item_mutation() :: String.t()
  def archive_project_item_mutation, do: @archive_project_item

  @spec unarchive_project_item_mutation() :: String.t()
  def unarchive_project_item_mutation, do: @unarchive_project_item

  @spec delete_project_item_mutation() :: String.t()
  def delete_project_item_mutation, do: @delete_project_item

  @spec archived_project_item_id(map()) :: {:ok, String.t()} | {:error, :archive_item_failed}
  def archived_project_item_id(%{"data" => %{"archiveProjectV2Item" => %{"item" => %{"id" => id}}}})
      when is_binary(id),
      do: {:ok, id}

  def archived_project_item_id(%{"data" => %{"unarchiveProjectV2Item" => %{"item" => %{"id" => id}}}})
      when is_binary(id),
      do: {:ok, id}

  def archived_project_item_id(_), do: {:error, :archive_item_failed}

  @spec deleted_project_item_id(map()) :: {:ok, String.t()} | {:error, :delete_item_failed}
  def deleted_project_item_id(%{"data" => %{"deleteProjectV2Item" => %{"deletedItemId" => id}}})
      when is_binary(id),
      do: {:ok, id}

  def deleted_project_item_id(_), do: {:error, :delete_item_failed}

  @spec status_options_query() :: String.t()
  def status_options_query, do: @status_options

  @spec update_field_value_mutation() :: String.t()
  def update_field_value_mutation, do: @update_field_value

  @spec repo_metadata_query() :: String.t()
  def repo_metadata_query, do: @repo_metadata

  @spec assignable_users_query() :: String.t()
  def assignable_users_query, do: @assignable_users

  @spec create_issue_mutation() :: String.t()
  def create_issue_mutation, do: @create_issue

  @spec add_project_item_mutation() :: String.t()
  def add_project_item_mutation, do: @add_project_item

  @spec issue_node_id_query() :: String.t()
  def issue_node_id_query, do: @issue_node_id

  @spec update_issue_mutation() :: String.t()
  def update_issue_mutation, do: @update_issue

  @spec updated_issue(map()) :: {:ok, map()} | {:error, :update_failed}
  def updated_issue(%{"data" => %{"updateIssue" => %{"issue" => %{"id" => id} = issue}}})
      when is_binary(id),
      do: {:ok, issue}

  def updated_issue(_), do: {:error, :update_failed}

  @spec issue_details(map()) :: {:ok, map()} | {:error, :issue_not_found}
  def issue_details(%{"data" => %{"repository" => %{"issue" => %{"id" => id} = issue}}})
      when is_binary(id),
      do: {:ok, issue}

  def issue_details(%{"data" => %{"repository" => %{"issue" => nil}}}), do: {:error, :issue_not_found}
  def issue_details(_), do: {:error, :issue_not_found}

  @spec add_labels_mutation() :: String.t()
  def add_labels_mutation, do: @add_labels

  @spec resolve_project_item_query() :: String.t()
  def resolve_project_item_query, do: @resolve_project_item

  @spec repository_id(map()) :: {:ok, String.t()} | {:error, :repository_not_found}
  def repository_id(%{"data" => %{"repository" => %{"id" => id}}}) when is_binary(id), do: {:ok, id}
  def repository_id(_), do: {:error, :repository_not_found}

  @spec labels(map()) :: [map()]
  def labels(%{"data" => %{"repository" => %{"labels" => %{"nodes" => nodes}}}}) when is_list(nodes) do
    Enum.map(nodes, fn node ->
      %{id: node["id"], name: node["name"], color: node["color"]}
    end)
  end

  def labels(_), do: []

  @spec assignable_users(map()) :: [map()]
  def assignable_users(%{"data" => %{"repository" => %{"assignableUsers" => %{"nodes" => nodes}}}})
      when is_list(nodes) do
    Enum.map(nodes, fn node ->
      %{id: node["id"], login: node["login"], name: node["name"], avatar_url: node["avatarUrl"]}
    end)
  end

  def assignable_users(_), do: []

  @spec created_issue(map()) :: {:ok, map()} | {:error, :create_failed}
  def created_issue(%{"data" => %{"createIssue" => %{"issue" => %{"id" => id} = issue}}})
      when is_binary(id) do
    {:ok, issue}
  end

  def created_issue(_), do: {:error, :create_failed}

  @spec project_item_id(map()) :: {:ok, String.t()} | {:error, :add_item_failed}
  def project_item_id(%{"data" => %{"addProjectV2ItemById" => %{"item" => %{"id" => id}}}})
      when is_binary(id) do
    {:ok, id}
  end

  def project_item_id(_), do: {:error, :add_item_failed}

  @spec resolve_field_and_option(map(), String.t(), String.t()) ::
          {:ok, String.t(), String.t()} | {:error, :status_not_found}
  def resolve_field_and_option(%{"data" => %{"node" => %{"fields" => %{"nodes" => nodes}}}}, status_field, option_name) do
    nodes
    |> Enum.find(fn n -> n["__typename"] == "ProjectV2SingleSelectField" and n["name"] == status_field end)
    |> case do
      %{"id" => field_id, "options" => options} ->
        case Enum.find(options, &(&1["name"] == option_name)) do
          %{"id" => option_id} -> {:ok, field_id, option_id}
          _ -> {:error, :status_not_found}
        end

      _ ->
        {:error, :status_not_found}
    end
  end

  def resolve_field_and_option(_, _, _), do: {:error, :status_not_found}

  @spec normalize_item(map(), String.t(), String.t()) :: IssueDTO.t() | nil
  def normalize_item(%{"content" => %{"__typename" => "Issue"} = content} = item, status_field, project_slug) do
    IssueDTO.build(%{
      id: content["id"],
      identifier: to_string(content["number"]),
      title: content["title"],
      description: content["body"],
      url: content["url"],
      assignee: first_login(content),
      assignee_remote_id: first_login(content),
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
