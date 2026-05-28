defmodule SymphonyElixir.GitHub.Client do
  @moduledoc """
  GitHub client used by the GitHub tracker adapter.

  All read and write paths run against the GitHub GraphQL API and the
  repo-scoped GitHub Projects v2 board configured by
  `SymphonyElixir.GitHub.Bootstrap`. Project metadata (project ID,
  status field ID/name, option map) is loaded from
  `.symphony/github-project.json`.

  Reads (`fetch_candidate_issues/1`, `fetch_issues_by_states/2`,
  `fetch_issue_states_by_ids/2`) query `projectV2.items` and filter on
  the configured `Symphony State` single-select field. Writes
  (`update_issue_state/3`, `create_comment/3`) issue GraphQL mutations
  against issue node IDs (no REST routes, no label juggling).
  """

  require Logger
  alias SymphonyElixir.{AgentRouting, Config, GitHub, Issue}
  alias SymphonyElixir.GitHub.{Blockers, IssueDiscussion, ProjectMetadata, RepoSpec, Viewer}

  @graphql_endpoint "https://api.github.com/graphql"
  @max_error_body_log_bytes 1_000
  @project_item_page_size 50
  @resolve_item_page_size 20

  @poll_items_query """
  query SymphonyGitHubPollItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          nodes {
            id
            content {
              __typename
              ... on Issue {
                id
                number
                title
                body
                url
                state
                repository {
                  nameWithOwner
                }
                assignees(first: 1) {
                  nodes { login }
                }
                labels(first: 20) {
                  nodes { name }
                }
                linkedBranches(first: 1) {
                  nodes { ref { name } }
                }
                trackedInIssues(first: 20) {
                  nodes {
                    ... on Issue {
                      id
                      number
                      state
                      repository { nameWithOwner }
                    }
                  }
                }
                comments(last: 30) {
                  nodes {
                    author { login }
                    body
                    createdAt
                  }
                }
                createdAt
                updatedAt
              }
            }
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2FieldCommon { id name }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
  """

  @issues_by_ids_query """
  query SymphonyGitHubIssuesByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Issue {
        id
        number
        title
        body
        url
        state
        repository { nameWithOwner }
        assignees(first: 1) { nodes { login } }
        labels(first: 20) { nodes { name } }
        linkedBranches(first: 1) {
          nodes { ref { name } }
        }
        trackedInIssues(first: 20) {
          nodes {
            ... on Issue {
              id
              number
              state
              repository { nameWithOwner }
            }
          }
        }
        comments(last: 30) {
          nodes {
            author { login }
            body
            createdAt
          }
        }
        createdAt
        updatedAt
        projectItems(first: 20) {
          nodes {
            id
            project { id }
            fieldValues(first: 30) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2FieldCommon { id name }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  """

  @add_comment_mutation """
  mutation SymphonyGitHubAddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge { node { id } }
    }
  }
  """

  @resolve_item_query """
  query SymphonyGitHubResolveItem($issueId: ID!, $first: Int!) {
    node(id: $issueId) {
      ... on Issue {
        id
        state
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

  @set_state_mutation """
  mutation SymphonyGitHubSetState(
    $projectId: ID!,
    $itemId: ID!,
    $fieldId: ID!,
    $optionId: String!
  ) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
  """

  @open_prs_query """
  query SymphonyGitHubIssueOpenPRs($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        closedByPullRequestsReferences(first: 30) {
          nodes { state }
        }
      }
    }
  }
  """

  # `stateReason: COMPLETED` is fixed for now. Per-state mapping
  # (NOT_PLANNED, DUPLICATE) can be added by extending Config or
  # ProjectMetadata if needed.
  @close_issue_mutation """
  mutation SymphonyGitHubCloseIssue($issueId: ID!) {
    closeIssue(input: { issueId: $issueId, stateReason: COMPLETED }) {
      issue { id state }
    }
  }
  """

  @reopen_issue_mutation """
  mutation SymphonyGitHubReopenIssue($issueId: ID!) {
    reopenIssue(input: { issueId: $issueId }) {
      issue { id state }
    }
  }
  """

  @admission_issues_query """
  query SymphonyGitHubAdmissionIssues(
    $owner: String!,
    $name: String!,
    $label: String!,
    $first: Int!,
    $after: String
  ) {
    repository(owner: $owner, name: $name) {
      issues(states: [OPEN], labels: [$label], first: $first, after: $after) {
        nodes {
          id
          number
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  """

  @project_item_content_ids_query """
  query SymphonyGitHubProjectContentIds(
    $projectId: ID!,
    $first: Int!,
    $after: String
  ) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          nodes {
            id
            content {
              ... on Issue { id }
              ... on PullRequest { id }
              ... on DraftIssue { id }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
  """

  @add_item_mutation """
  mutation SymphonyGitHubAddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
  """

  @spec fetch_candidate_issues(keyword()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_candidate_issues(opts \\ []) when is_list(opts) do
    client = client_module(opts)
    graphql_opts = forward_graphql_opts(opts)

    with {:ok, assignee_filter} <- routing_assignee_filter(opts),
         {:ok, metadata, repo} <- prepare_project_context(opts),
         :ok <- admit_labeled_issues(client, metadata, repo, graphql_opts) do
      do_poll_project_items(metadata, repo, Config.active_states(), assignee_filter, opts)
    end
  end

  @spec fetch_issues_by_states([String.t()], keyword()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(state_names, opts \\ [])
      when is_list(state_names) and is_list(opts) do
    normalized = Enum.map(state_names, &to_string/1) |> Enum.uniq()

    case normalized do
      [] ->
        {:ok, []}

      _ ->
        client = client_module(opts)
        graphql_opts = forward_graphql_opts(opts)

        with {:ok, assignee_filter} <- routing_assignee_filter(opts),
             {:ok, metadata, repo} <- prepare_project_context(opts),
             :ok <- admit_labeled_issues(client, metadata, repo, graphql_opts) do
          do_poll_project_items(metadata, repo, normalized, assignee_filter, opts)
        end
    end
  end

  @spec fetch_issue_states_by_ids([String.t()], keyword()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issue_states_by_ids(issue_ids, opts \\ [])
      when is_list(issue_ids) and is_list(opts) do
    ids = issue_ids |> Enum.filter(&is_binary/1) |> Enum.uniq()

    case ids do
      [] ->
        {:ok, []}

      _ ->
        with {:ok, assignee_filter} <- routing_assignee_filter(opts),
             {:ok, metadata, repo} <- prepare_project_context(opts) do
          do_fetch_issues_by_ids(ids, metadata, repo, assignee_filter, opts)
        end
    end
  end

  @spec create_comment(String.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def create_comment(issue_id, body, opts \\ [])
      when is_binary(issue_id) and is_binary(body) do
    variables = %{"subjectId" => issue_id, "body" => body}
    graphql_opts = forward_graphql_opts(opts)

    case graphql(@add_comment_mutation, variables, graphql_opts) do
      {:ok, _body} -> :ok
      {:error, _} = error -> error
    end
  end

  @spec update_issue_state(String.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def update_issue_state(issue_id, state_name, opts \\ [])
      when is_binary(issue_id) and is_binary(state_name) do
    base_dir = Keyword.get(opts, :base_dir, File.cwd!())
    client = client_module(opts)
    graphql_opts = forward_graphql_opts(opts)

    with {:ok, metadata} <- ProjectMetadata.read(base_dir),
         {:ok, option_id} <- lookup_state_option_id(metadata, state_name),
         {:ok, item_id, current_open_state} <-
           resolve_project_item(client, issue_id, metadata["project_id"], graphql_opts),
         :ok <-
           set_project_state(client, metadata, item_id, option_id, state_name, graphql_opts) do
      transition_open_state(client, issue_id, state_name, current_open_state, graphql_opts)
    end
  end

  @doc """
  Returns whether the issue has at least one open pull request that references it.
  """
  @spec issue_has_open_pull_request?(integer() | String.t(), keyword()) ::
          {:ok, boolean()} | {:error, term()}
  def issue_has_open_pull_request?(issue_number, opts \\ []) do
    with {:ok, {owner, name}} <- RepoSpec.split(GitHub.Config.repo()),
         number when is_integer(number) <- parse_issue_number(issue_number) do
      client = client_module(opts)
      graphql_opts = forward_graphql_opts(opts)

      variables = %{"owner" => owner, "name" => name, "number" => number}

      case client.graphql(@open_prs_query, variables, graphql_opts) do
        {:ok, %{"data" => %{"repository" => %{"issue" => %{} = issue}}}} ->
          {:ok, issue_has_open_pr_references?(issue)}

        {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}} ->
          {:ok, false}

        {:ok, body} ->
          {:error, {:open_pr_lookup_unexpected, body}}

        {:error, _} = error ->
          error
      end
    else
      {:error, _} = error ->
        error

      _ ->
        {:error, :invalid_issue_number}
    end
  end

  @spec graphql(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def graphql(query, variables \\ %{}, opts \\ [])
      when is_binary(query) and is_map(variables) and is_list(opts) do
    payload = build_graphql_payload(query, variables, Keyword.get(opts, :operation_name))
    request_fun = Keyword.get(opts, :request_fun, &post_graphql_request/2)

    with {:ok, token} <- require_token(),
         headers = graphql_headers(token),
         {:ok, %{status: 200, body: body}} <- request_fun.(payload, headers),
         {:ok, decoded} <- decode_graphql_response(body) do
      {:ok, decoded}
    else
      {:error, :missing_github_token} = error ->
        error

      {:ok, response} ->
        Logger.error(
          "GitHub GraphQL request failed status=#{response.status}" <>
            github_error_context(payload, response)
        )

        {:error, {:github_api_status, response.status}}

      {:error, {:github_graphql_errors, _} = err} ->
        {:error, err}

      {:error, :github_unknown_payload} = error ->
        error

      {:error, reason} ->
        Logger.error("GitHub GraphQL request failed: #{inspect(reason)}")
        {:error, {:github_api_request, reason}}
    end
  end

  @doc false
  @spec normalize_project_item_for_test(map(), String.t()) :: Issue.t() | nil
  def normalize_project_item_for_test(item, status_field_name)
      when is_map(item) and is_binary(status_field_name) do
    normalize_project_item(item, status_field_name)
  end

  # -- GraphQL polling helpers ------------------------------------------------

  defp prepare_project_context(opts) do
    base_dir = Keyword.get(opts, :base_dir, File.cwd!())

    with {:ok, metadata} <- ProjectMetadata.read(base_dir),
         {:ok, repo} <- require_repo() do
      {:ok, metadata, repo}
    end
  end

  defp require_repo do
    case GitHub.Config.repo() do
      repo when is_binary(repo) and repo != "" -> {:ok, repo}
      _ -> {:error, :missing_github_repo}
    end
  end

  defp do_poll_project_items(metadata, repo, state_names, assignee_filter, opts) do
    project_id = metadata["project_id"]
    status_field_name = metadata["status_field_name"] || GitHub.Config.status_field()
    state_set = MapSet.new(state_names)
    graphql_opts = forward_graphql_opts(opts)

    case fetch_all_project_items(project_id, nil, [], graphql_opts) do
      {:ok, items} ->
        issues =
          items
          |> build_candidate_records(status_field_name, repo, assignee_filter)
          |> filter_candidate_records(repo, state_set)
          |> IssueDiscussion.enrich_issues(repo, opts)

        {:ok, issues}

      {:error, _} = error ->
        error
    end
  end

  defp fetch_all_project_items(project_id, after_cursor, acc, graphql_opts) do
    variables = %{
      "projectId" => project_id,
      "first" => @project_item_page_size,
      "after" => after_cursor
    }

    case graphql(@poll_items_query, variables, graphql_opts) do
      {:ok, body} ->
        case decode_items_page(body) do
          {:ok, nodes, %{has_next_page: true, end_cursor: cursor}}
          when is_binary(cursor) and cursor != "" ->
            fetch_all_project_items(project_id, cursor, prepend_nodes(nodes, acc), graphql_opts)

          {:ok, nodes, %{has_next_page: false}} ->
            {:ok, finalize_nodes(prepend_nodes(nodes, acc))}

          {:ok, _nodes, %{has_next_page: true, end_cursor: _}} ->
            {:error, :github_missing_end_cursor}

          {:error, reason} ->
            {:error, reason}
        end

      {:error, _} = error ->
        error
    end
  end

  defp decode_items_page(%{
         "data" => %{
           "node" => %{
             "items" => %{
               "nodes" => nodes,
               "pageInfo" => %{"hasNextPage" => has_next, "endCursor" => cursor}
             }
           }
         }
       })
       when is_list(nodes) do
    {:ok, nodes, %{has_next_page: has_next == true, end_cursor: cursor}}
  end

  defp decode_items_page(%{"data" => %{"node" => nil}}),
    do: {:error, :github_project_not_found}

  defp decode_items_page(_body), do: {:error, :github_unknown_payload}

  defp prepend_nodes(nodes, acc) when is_list(nodes) and is_list(acc) do
    Enum.reverse(nodes, acc)
  end

  defp finalize_nodes(acc) when is_list(acc), do: Enum.reverse(acc)

  defp build_candidate_records(items, status_field_name, default_repo, assignee_filter) do
    Enum.flat_map(items, fn item ->
      case extract_issue_content(item) do
        {:ok, content} ->
          issue =
            build_issue_from_content(content, item, status_field_name, default_repo, assignee_filter)

          repo = get_in(content, ["repository", "nameWithOwner"])
          [{issue, repo}]

        :skip ->
          []
      end
    end)
  end

  defp extract_issue_content(%{"content" => %{"__typename" => "Issue"} = content}),
    do: {:ok, content}

  defp extract_issue_content(_item), do: :skip

  defp filter_candidate_records(records, repo, state_set) do
    records
    |> Enum.filter(fn {issue, item_repo} ->
      not is_nil(issue.state) and
        item_repo == repo and
        MapSet.member?(state_set, issue.state)
    end)
    |> Enum.map(fn {issue, _repo} -> issue end)
  end

  defp normalize_project_item(item, status_field_name) do
    case extract_issue_content(item) do
      {:ok, content} ->
        repo = get_in(content, ["repository", "nameWithOwner"]) || ""
        build_issue_from_content(content, item, status_field_name, repo, nil)

      :skip ->
        nil
    end
  end

  defp build_issue_from_content(content, item, status_field_name, default_repo, assignee_filter) do
    raw_labels = extract_raw_label_names(content)
    assignee_login = extract_first_assignee_login(content)
    agent_kind = resolve_issue_agent_kind(raw_labels)

    %Issue{
      id: content["id"],
      identifier: format_identifier(content["number"]),
      title: content["title"],
      description: content["body"],
      priority: extract_priority_from_labels(raw_labels),
      state: resolve_issue_state(item, status_field_name, raw_labels),
      branch_name: extract_linked_branch_name(content),
      url: content["url"],
      assignee_id: assignee_login,
      blocked_by: extract_blockers(content, default_repo),
      labels: filter_visible_labels(raw_labels),
      comments: IssueDiscussion.parse_issue_comments(content),
      agent_kind: agent_kind,
      assigned_to_worker: not is_nil(agent_kind) and assigned_to_worker?(assignee_login, assignee_filter),
      created_at: parse_datetime(content["createdAt"]),
      updated_at: parse_datetime(content["updatedAt"])
    }
  end

  defp extract_raw_label_names(%{"labels" => %{"nodes" => nodes}}) when is_list(nodes) do
    nodes
    |> Enum.map(&Map.get(&1, "name"))
    |> Enum.filter(&is_binary/1)
  end

  defp extract_raw_label_names(_content), do: []

  defp extract_first_assignee_login(%{"assignees" => %{"nodes" => [node | _]}})
       when is_map(node) do
    case Map.get(node, "login") do
      login when is_binary(login) and login != "" -> login
      _ -> nil
    end
  end

  defp extract_first_assignee_login(_content), do: nil

  defp filter_visible_labels(label_names) do
    label_names
    |> Enum.reject(fn label ->
      AgentRouting.symphony_label?(label) or priority_label?(label)
    end)
    |> Enum.map(&String.downcase/1)
  end

  defp priority_label?(label) when is_binary(label) do
    Regex.match?(~r/^priority:\d+$/, label)
  end

  defp extract_priority_from_labels(label_names) do
    Enum.find_value(label_names, &parse_priority_label/1)
  end

  defp parse_priority_label(name) do
    with [_, n] <- Regex.run(~r/^priority:(\d+)$/i, name),
         {priority, ""} <- Integer.parse(n) do
      priority
    else
      _ -> nil
    end
  end

  defp resolve_issue_state(item, status_field_name, label_names) do
    extract_status_value(item, status_field_name) ||
      extract_status_value(item, GitHub.Config.native_status_field()) ||
      extract_state_from_labels(label_names)
  end

  defp extract_status_value(%{"fieldValues" => %{"nodes" => nodes}}, status_field_name)
       when is_list(nodes) and is_binary(status_field_name) do
    Enum.find_value(nodes, fn node ->
      with %{
             "__typename" => "ProjectV2ItemFieldSingleSelectValue",
             "name" => value_name,
             "field" => %{"name" => field_name}
           } <- node,
           true <- is_binary(value_name),
           true <- field_name == status_field_name do
        value_name
      else
        _ -> nil
      end
    end)
  end

  defp extract_status_value(_item, _status_field_name), do: nil

  defp extract_state_from_labels(label_names) when is_list(label_names) do
    state_names_by_key =
      configured_state_names()
      |> Map.new(fn state_name -> {normalize_state_key(state_name), state_name} end)

    Enum.find_value(label_names, fn label_name ->
      with candidate when is_binary(candidate) <- extract_symphony_state_label(label_name),
           state_name when is_binary(state_name) <-
             Map.get(state_names_by_key, normalize_state_key(candidate)) do
        state_name
      else
        _ -> nil
      end
    end)
  end

  defp extract_state_from_labels(_label_names), do: nil

  defp configured_state_names do
    (Config.field_states() ++ Config.active_states() ++ Config.terminal_states())
    |> Enum.filter(&is_binary/1)
    |> Enum.uniq()
  end

  defp extract_symphony_state_label(label_name) when is_binary(label_name) do
    case String.split(String.trim(label_name), ":", parts: 2) do
      ["symphony", state_name] when state_name != "" -> state_name
      _ -> nil
    end
  end

  defp extract_symphony_state_label(_label_name), do: nil

  defp normalize_state_key(state_name) when is_binary(state_name) do
    state_name
    |> String.trim()
    |> String.downcase()
    |> String.replace(~r/[\s_-]+/, " ")
  end

  defp normalize_state_key(_state_name), do: ""

  defp format_identifier(number) when is_integer(number), do: Integer.to_string(number)
  defp format_identifier(number) when is_binary(number), do: number
  defp format_identifier(_), do: nil

  # -- by-id helpers -----------------------------------------------------------

  defp do_fetch_issues_by_ids(ids, metadata, repo, assignee_filter, opts) do
    project_id = metadata["project_id"]
    status_field_name = metadata["status_field_name"] || GitHub.Config.status_field()
    graphql_opts = forward_graphql_opts(opts)

    case graphql(@issues_by_ids_query, %{"ids" => ids}, graphql_opts) do
      {:ok, %{"data" => %{"nodes" => nodes}}} when is_list(nodes) ->
        issues =
          nodes
          |> build_issues_from_nodes(project_id, status_field_name, repo, assignee_filter)
          |> IssueDiscussion.enrich_issues(repo, opts)

        {:ok, issues}

      {:ok, _body} ->
        {:error, :github_unknown_payload}

      {:error, _} = error ->
        error
    end
  end

  defp build_issues_from_nodes(nodes, project_id, status_field_name, repo, assignee_filter) do
    Enum.flat_map(nodes, fn node ->
      case build_issue_from_node(node, project_id, status_field_name, repo, assignee_filter) do
        nil -> []
        issue -> [issue]
      end
    end)
  end

  defp build_issue_from_node(
         %{"__typename" => "Issue"} = node,
         project_id,
         status_field_name,
         repo,
         assignee_filter
       ) do
    if get_in(node, ["repository", "nameWithOwner"]) == repo do
      project_item = find_project_item(node, project_id)

      raw_labels = extract_raw_label_names(node)

      state =
        case project_item do
          nil -> nil
          item -> resolve_issue_state(item, status_field_name, raw_labels)
        end

      assignee_login = extract_first_assignee_login(node)
      agent_kind = resolve_issue_agent_kind(raw_labels)

      %Issue{
        id: node["id"],
        identifier: format_identifier(node["number"]),
        title: node["title"],
        description: node["body"],
        priority: extract_priority_from_labels(raw_labels),
        state: state,
        branch_name: extract_linked_branch_name(node),
        url: node["url"],
        assignee_id: assignee_login,
        blocked_by: extract_blockers(node, repo),
        labels: filter_visible_labels(raw_labels),
        comments: IssueDiscussion.parse_issue_comments(node),
        agent_kind: agent_kind,
        assigned_to_worker: not is_nil(agent_kind) and assigned_to_worker?(assignee_login, assignee_filter),
        created_at: parse_datetime(node["createdAt"]),
        updated_at: parse_datetime(node["updatedAt"])
      }
    end
  end

  defp build_issue_from_node(_node, _project_id, _status_field_name, _repo, _assignee_filter),
    do: nil

  defp extract_linked_branch_name(content) do
    case get_in(content, ["linkedBranches", "nodes"]) do
      [%{"ref" => %{"name" => name}} | _] when is_binary(name) and name != "" -> name
      _ -> nil
    end
  end

  defp extract_blockers(content, default_repo) when is_binary(default_repo) do
    tracked = Blockers.from_tracked(content)
    parsed = Blockers.from_body(Map.get(content, "body"), default_repo)
    Blockers.merge(tracked, parsed)
  end

  defp routing_assignee_filter(opts) do
    base_dir = Keyword.get(opts, :base_dir, File.cwd!())

    case GitHub.Config.assignee() do
      nil ->
        {:ok, nil}

      assignee ->
        build_assignee_filter(assignee, base_dir)
    end
  end

  defp build_assignee_filter(assignee, base_dir) when is_binary(assignee) do
    case normalize_assignee_match_value(assignee) do
      nil ->
        {:ok, nil}

      "me" ->
        case Viewer.cached_login(base_dir) do
          login when is_binary(login) ->
            {:ok, %{configured_assignee: "me", match_values: MapSet.new([login])}}

          _ ->
            {:error, :missing_github_viewer_login}
        end

      normalized ->
        {:ok, %{configured_assignee: assignee, match_values: MapSet.new([normalized])}}
    end
  end

  defp normalize_assignee_match_value(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      normalized -> String.downcase(normalized)
    end
  end

  defp resolve_issue_agent_kind(label_names) when is_list(label_names) do
    AgentRouting.resolve_agent_kind(
      label_names,
      Config.configured_agent_kinds(),
      Config.default_agent_kind()
    )
  end

  defp assigned_to_worker?(_assignee_login, nil), do: true

  defp assigned_to_worker?(assignee_login, %{match_values: match_values})
       when is_struct(match_values, MapSet) do
    case assignee_login do
      login when is_binary(login) ->
        MapSet.member?(match_values, String.downcase(login))

      _ ->
        false
    end
  end

  defp find_project_item(%{"projectItems" => %{"nodes" => items}}, project_id)
       when is_list(items) and is_binary(project_id) do
    Enum.find(items, fn
      %{"project" => %{"id" => id}} -> id == project_id
      _ -> false
    end)
  end

  defp find_project_item(_node, _project_id), do: nil

  defp forward_graphql_opts(opts) do
    Keyword.take(opts, [:request_fun, :operation_name])
  end

  # -- Admission helpers ------------------------------------------------------

  defp admit_labeled_issues(client, metadata, repo, graphql_opts) do
    case Config.active_states() do
      [first_active | _] ->
        do_admit_labeled_issues(client, metadata, repo, first_active, graphql_opts)

      _ ->
        :ok
    end
  end

  defp do_admit_labeled_issues(client, metadata, repo, first_active, graphql_opts) do
    labels = AgentRouting.admission_labels()

    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, candidates} <- fetch_admission_candidates_for_labels(client, owner, name, labels, graphql_opts),
         {:ok, missing} <-
           resolve_missing_admissions(client, metadata, candidates, graphql_opts) do
      run_admissions(client, metadata, missing, first_active, graphql_opts)
    else
      {:error, :missing_github_token} = error -> error
      {:error, reason} -> {:error, {:admission_failed, reason}}
    end
  end

  defp fetch_admission_candidates_for_labels(client, owner, name, labels, graphql_opts) do
    labels
    |> Enum.reduce_while({:ok, []}, fn label, {:ok, acc} ->
      case fetch_admission_candidates(client, owner, name, label, graphql_opts) do
        {:ok, ids} -> {:cont, {:ok, acc ++ ids}}
        {:error, _} = error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, ids} -> {:ok, Enum.uniq(ids)}
      error -> error
    end
  end

  defp run_admissions(_client, _metadata, [], _first_active, _graphql_opts), do: :ok

  defp run_admissions(client, metadata, missing, first_active, graphql_opts) do
    Logger.debug(fn -> "Admitting #{length(missing)} issue(s) to Symphony board" end)
    admit_each(client, metadata, missing, first_active, graphql_opts)
  end

  defp resolve_missing_admissions(_client, _metadata, [], _graphql_opts), do: {:ok, []}

  defp resolve_missing_admissions(client, metadata, candidates, graphql_opts) do
    case fetch_project_content_ids(client, metadata["project_id"], graphql_opts) do
      {:ok, existing} -> {:ok, candidates -- existing}
      {:error, _} = error -> error
    end
  end

  defp fetch_admission_candidates(client, owner, name, label, graphql_opts) do
    fetch_admission_candidates_page(client, owner, name, label, nil, [], graphql_opts)
  end

  defp fetch_admission_candidates_page(client, owner, name, label, after_cursor, acc, graphql_opts) do
    variables = %{
      "owner" => owner,
      "name" => name,
      "label" => label,
      "first" => @project_item_page_size,
      "after" => after_cursor
    }

    case client.graphql(@admission_issues_query, variables, graphql_opts) do
      {:ok, body} ->
        case decode_admission_page(body) do
          {:ok, ids, %{has_next_page: true, end_cursor: cursor}}
          when is_binary(cursor) and cursor != "" ->
            fetch_admission_candidates_page(
              client,
              owner,
              name,
              label,
              cursor,
              prepend_nodes(ids, acc),
              graphql_opts
            )

          {:ok, ids, %{has_next_page: false}} ->
            {:ok, finalize_nodes(prepend_nodes(ids, acc))}

          {:ok, _ids, %{has_next_page: true}} ->
            {:error, :github_missing_end_cursor}

          {:error, reason} ->
            {:error, reason}
        end

      {:error, _} = error ->
        error
    end
  end

  defp decode_admission_page(%{
         "data" => %{
           "repository" => %{
             "issues" => %{
               "nodes" => nodes,
               "pageInfo" => %{"hasNextPage" => has_next, "endCursor" => cursor}
             }
           }
         }
       })
       when is_list(nodes) do
    ids =
      Enum.flat_map(nodes, fn
        %{"id" => id} when is_binary(id) -> [id]
        _ -> []
      end)

    {:ok, ids, %{has_next_page: has_next == true, end_cursor: cursor}}
  end

  defp decode_admission_page(%{"data" => %{"repository" => nil}}),
    do: {:error, :github_repo_not_found}

  defp decode_admission_page(_body), do: {:error, :github_unknown_payload}

  defp fetch_project_content_ids(client, project_id, graphql_opts) do
    fetch_project_content_ids_page(client, project_id, nil, [], graphql_opts)
  end

  defp fetch_project_content_ids_page(client, project_id, after_cursor, acc, graphql_opts) do
    variables = %{
      "projectId" => project_id,
      "first" => @project_item_page_size,
      "after" => after_cursor
    }

    case client.graphql(@project_item_content_ids_query, variables, graphql_opts) do
      {:ok, body} ->
        case decode_project_content_page(body) do
          {:ok, ids, %{has_next_page: true, end_cursor: cursor}}
          when is_binary(cursor) and cursor != "" ->
            fetch_project_content_ids_page(
              client,
              project_id,
              cursor,
              prepend_nodes(ids, acc),
              graphql_opts
            )

          {:ok, ids, %{has_next_page: false}} ->
            {:ok, finalize_nodes(prepend_nodes(ids, acc))}

          {:ok, _ids, %{has_next_page: true}} ->
            {:error, :github_missing_end_cursor}

          {:error, reason} ->
            {:error, reason}
        end

      {:error, _} = error ->
        error
    end
  end

  defp decode_project_content_page(%{
         "data" => %{
           "node" => %{
             "items" => %{
               "nodes" => nodes,
               "pageInfo" => %{"hasNextPage" => has_next, "endCursor" => cursor}
             }
           }
         }
       })
       when is_list(nodes) do
    ids =
      Enum.flat_map(nodes, fn
        %{"content" => %{"id" => id}} when is_binary(id) -> [id]
        _ -> []
      end)

    {:ok, ids, %{has_next_page: has_next == true, end_cursor: cursor}}
  end

  defp decode_project_content_page(%{"data" => %{"node" => nil}}),
    do: {:error, :github_project_not_found}

  defp decode_project_content_page(_body), do: {:error, :github_unknown_payload}

  defp admit_each(client, metadata, missing, first_active, graphql_opts) do
    Enum.each(missing, fn issue_id ->
      case admit_one(client, metadata, issue_id, first_active, graphql_opts) do
        :ok ->
          Logger.info("Admitted issue #{issue_id} to Symphony board")

        {:error, {:orphan_state_failure, item_id, reason}} ->
          Logger.error("Admitted issue #{issue_id} (project item #{item_id}) but Symphony State setup failed: #{inspect(reason)}. Item will be retried on next poll if it remains stateless.")

        {:error, reason} ->
          Logger.warning("Admission failed for issue #{issue_id}: #{inspect(reason)}")
      end
    end)

    :ok
  end

  defp admit_one(client, metadata, issue_id, first_active, graphql_opts) do
    with {:ok, item_id} <-
           add_project_item(client, metadata["project_id"], issue_id, graphql_opts),
         {:ok, option_id} <- lookup_state_option_id(metadata, first_active) do
      case set_project_state(client, metadata, item_id, option_id, first_active, graphql_opts) do
        :ok -> :ok
        {:error, reason} -> {:error, {:orphan_state_failure, item_id, reason}}
      end
    end
  end

  defp add_project_item(client, project_id, content_id, graphql_opts)
       when is_atom(client) and is_binary(project_id) and is_binary(content_id) do
    variables = %{"projectId" => project_id, "contentId" => content_id}

    case client.graphql(@add_item_mutation, variables, graphql_opts) do
      {:ok, %{"data" => %{"addProjectV2ItemById" => %{"item" => %{"id" => item_id}}}}}
      when is_binary(item_id) ->
        {:ok, item_id}

      {:ok, body} ->
        {:error, {:add_item_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # -- GraphQL write helpers --------------------------------------------------

  defp lookup_state_option_id(metadata, state_name) do
    options =
      case Map.get(metadata, "state_options") do
        %{} = map -> map
        _ -> %{}
      end

    case Map.get(options, state_name) do
      option_id when is_binary(option_id) and option_id != "" ->
        {:ok, option_id}

      _ ->
        {:error, {:unknown_state, state_name}}
    end
  end

  defp client_module(opts) do
    Keyword.get(opts, :client_module, __MODULE__)
  end

  defp resolve_project_item(client, issue_id, project_id, graphql_opts)
       when is_atom(client) and is_binary(issue_id) and is_binary(project_id) do
    variables = %{"issueId" => issue_id, "first" => @resolve_item_page_size}

    case client.graphql(@resolve_item_query, variables, graphql_opts) do
      {:ok,
       %{
         "data" => %{
           "node" => %{
             "id" => _,
             "state" => current_state,
             "projectItems" => %{"nodes" => nodes}
           }
         }
       }}
      when is_binary(current_state) ->
        case find_item_id(nodes, project_id) do
          nil -> {:error, {:issue_not_in_project, issue_id}}
          item_id -> {:ok, item_id, current_state}
        end

      {:ok, %{"data" => %{"node" => nil}}} ->
        {:error, {:issue_not_found, issue_id}}

      {:ok, body} ->
        {:error, {:resolve_item_unexpected, body}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp find_item_id(nodes, project_id) do
    nodes
    |> List.wrap()
    |> Enum.find_value(fn
      %{"id" => id, "project" => %{"id" => ^project_id}} -> id
      _ -> nil
    end)
  end

  defp set_project_state(client, metadata, item_id, option_id, state_name, graphql_opts)
       when is_atom(client) do
    with :ok <-
           set_field_value(
             client,
             metadata["project_id"],
             item_id,
             metadata["status_field_id"],
             option_id,
             graphql_opts
           ),
         :ok <- sync_native_status_field(client, metadata, item_id, state_name, graphql_opts) do
      :ok
    end
  end

  defp set_field_value(client, project_id, item_id, field_id, option_id, graphql_opts)
       when is_atom(client) do
    variables = %{
      "projectId" => project_id,
      "itemId" => item_id,
      "fieldId" => field_id,
      "optionId" => option_id
    }

    case client.graphql(@set_state_mutation, variables, graphql_opts) do
      {:ok, _body} -> :ok
      {:error, _} = error -> error
    end
  end

  defp sync_native_status_field(client, metadata, item_id, state_name, graphql_opts)
       when is_atom(client) do
    if GitHub.Config.sync_native_status?() do
      with field_id when is_binary(field_id) <- Map.get(metadata, "native_status_field_id"),
           {:ok, native_option_id} <- lookup_native_state_option_id(metadata, state_name) do
        set_field_value(
          client,
          metadata["project_id"],
          item_id,
          field_id,
          native_option_id,
          graphql_opts
        )
      else
        _ -> :ok
      end
    else
      :ok
    end
  end

  defp lookup_native_state_option_id(metadata, state_name) do
    case Map.get(metadata, "native_state_options") do
      %{} = options ->
        case Map.get(options, state_name) do
          option_id when is_binary(option_id) and option_id != "" -> {:ok, option_id}
          _ -> {:error, :unknown_native_state}
        end

      _ ->
        {:error, :missing_native_state_options}
    end
  end

  defp issue_has_open_pr_references?(%{"closedByPullRequestsReferences" => %{"nodes" => nodes}}) do
    nodes
    |> List.wrap()
    |> Enum.any?(fn
      %{"state" => "OPEN"} -> true
      _ -> false
    end)
  end

  defp issue_has_open_pr_references?(_issue), do: false

  defp parse_issue_number(number) when is_integer(number) and number > 0, do: number

  defp parse_issue_number(number) when is_binary(number) do
    number
    |> String.trim()
    |> case do
      "" ->
        {:error, :invalid_issue_number}

      trimmed ->
        case Integer.parse(trimmed) do
          {parsed, ""} when parsed > 0 -> parsed
          _ -> {:error, :invalid_issue_number}
        end
    end
  end

  defp parse_issue_number(_), do: {:error, :invalid_issue_number}

  defp transition_open_state(client, issue_id, state_name, current_open_state, graphql_opts)
       when is_atom(client) do
    cond do
      terminal_state?(state_name) and current_open_state == "OPEN" ->
        close_issue(client, issue_id, graphql_opts)

      active_state?(state_name) and current_open_state == "CLOSED" ->
        reopen_issue(client, issue_id, graphql_opts)

      true ->
        :ok
    end
  end

  defp close_issue(client, issue_id, graphql_opts) when is_atom(client) do
    case client.graphql(@close_issue_mutation, %{"issueId" => issue_id}, graphql_opts) do
      {:ok, _body} -> :ok
      {:error, _} = error -> error
    end
  end

  defp reopen_issue(client, issue_id, graphql_opts) when is_atom(client) do
    case client.graphql(@reopen_issue_mutation, %{"issueId" => issue_id}, graphql_opts) do
      {:ok, _body} -> :ok
      {:error, _} = error -> error
    end
  end

  defp terminal_state?(state_name) when is_binary(state_name) do
    state_name in Config.terminal_states()
  end

  defp active_state?(state_name) when is_binary(state_name) do
    state_name in Config.active_states()
  end

  # -- Shared helpers ---------------------------------------------------------

  defp require_token do
    case GitHub.Config.token() do
      nil -> {:error, :missing_github_token}
      token -> {:ok, token}
    end
  end

  defp parse_datetime(nil), do: nil

  defp parse_datetime(raw) when is_binary(raw) do
    case DateTime.from_iso8601(raw) do
      {:ok, dt, _offset} -> dt
      _ -> nil
    end
  end

  defp parse_datetime(_), do: nil

  defp graphql_headers(token) do
    [
      {"Authorization", "Bearer #{token}"},
      {"Content-Type", "application/json"},
      {"Accept", "application/vnd.github+json"},
      {"X-GitHub-Api-Version", "2022-11-28"}
    ]
  end

  defp build_graphql_payload(query, variables, operation_name) do
    %{
      "query" => query,
      "variables" => variables
    }
    |> maybe_put_operation_name(operation_name)
  end

  defp maybe_put_operation_name(payload, operation_name) when is_binary(operation_name) do
    case String.trim(operation_name) do
      "" -> payload
      trimmed -> Map.put(payload, "operationName", trimmed)
    end
  end

  defp maybe_put_operation_name(payload, _operation_name), do: payload

  defp post_graphql_request(payload, headers) do
    Req.post(@graphql_endpoint,
      headers: headers,
      json: payload,
      connect_options: [timeout: 30_000]
    )
  end

  defp decode_graphql_response(%{"errors" => errors}) when is_list(errors) and errors != [] do
    {:error, {:github_graphql_errors, errors}}
  end

  defp decode_graphql_response(body) when is_map(body), do: {:ok, body}
  defp decode_graphql_response(_body), do: {:error, :github_unknown_payload}

  defp github_error_context(payload, response) when is_map(payload) do
    operation_name =
      case Map.get(payload, "operationName") do
        name when is_binary(name) and name != "" -> " operation=#{name}"
        _ -> ""
      end

    body =
      response
      |> Map.get(:body)
      |> summarize_error_body()

    operation_name <> " body=" <> body
  end

  defp summarize_error_body(body) when is_binary(body) do
    body
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> truncate_error_body()
    |> inspect()
  end

  defp summarize_error_body(body) do
    body
    |> inspect(limit: 20, printable_limit: @max_error_body_log_bytes)
    |> truncate_error_body()
  end

  defp truncate_error_body(body) when is_binary(body) do
    if byte_size(body) > @max_error_body_log_bytes do
      binary_part(body, 0, @max_error_body_log_bytes) <> "...<truncated>"
    else
      body
    end
  end
end
