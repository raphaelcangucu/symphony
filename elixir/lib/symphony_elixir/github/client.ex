defmodule SymphonyElixir.GitHub.Client do
  @moduledoc """
  GitHub client used by the GitHub tracker adapter.

  Read paths (`fetch_candidate_issues/1`, `fetch_issues_by_states/2`,
  `fetch_issue_states_by_ids/2`) use GraphQL against a repo-scoped
  GitHub Projects v2 board. Project metadata (project ID, status
  field ID/name, option map) is loaded from `.symphony/github-project.json`,
  which `SymphonyElixir.GitHub.Bootstrap` writes on first start.

  Write paths (`update_issue_state/3`, `create_comment/3`) still use
  the REST API; they are rewritten in a later task.
  """

  require Logger
  alias SymphonyElixir.{Config, GitHub, Issue}
  alias SymphonyElixir.GitHub.ProjectMetadata

  @base_url "https://api.github.com"
  @graphql_endpoint "https://api.github.com/graphql"
  @max_error_body_log_bytes 1_000
  @project_item_page_size 50

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
        createdAt
        updatedAt
        projectItems(first: 5) {
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

  @spec fetch_candidate_issues(keyword()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_candidate_issues(opts \\ []) when is_list(opts) do
    with {:ok, metadata, repo} <- prepare_project_context(opts) do
      do_poll_project_items(metadata, repo, Config.active_states(), opts)
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
        with {:ok, metadata, repo} <- prepare_project_context(opts) do
          do_poll_project_items(metadata, repo, normalized, opts)
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
        with {:ok, metadata, repo} <- prepare_project_context(opts) do
          do_fetch_issues_by_ids(ids, metadata, repo, opts)
        end
    end
  end

  @spec create_comment(String.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def create_comment(issue_number, body, opts \\ [])
      when is_binary(issue_number) and is_binary(body) do
    with {:ok, {owner, repo}} <- parse_repo(),
         {:ok, token} <- require_token() do
      request_fun = Keyword.get(opts, :request_fun, &default_request_fun/1)
      url = "#{@base_url}/repos/#{owner}/#{repo}/issues/#{issue_number}/comments"

      case request_fun.(%{method: :post, url: url, token: token, body: %{"body" => body}}) do
        {:ok, %{status: status}} when status in [200, 201] ->
          :ok

        {:ok, %{status: status}} ->
          Logger.error("GitHub create_comment failed status=#{status}")
          {:error, {:github_api_status, status}}

        {:error, reason} ->
          {:error, {:github_api_request, reason}}
      end
    end
  end

  @spec update_issue_state(String.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def update_issue_state(issue_number, state_name, opts \\ [])
      when is_binary(issue_number) and is_binary(state_name) do
    with {:ok, {owner, repo}} <- parse_repo(),
         {:ok, token} <- require_token() do
      prefix = GitHub.Config.label_prefix()
      request_fun = Keyword.get(opts, :request_fun, &default_request_fun/1)
      issue_url = "#{@base_url}/repos/#{owner}/#{repo}/issues/#{issue_number}"

      do_update_issue_state(request_fun, token, issue_url, owner, repo, issue_number, prefix, state_name)
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

  defp do_poll_project_items(metadata, repo, state_names, opts) do
    project_id = metadata["project_id"]
    status_field_name = metadata["status_field_name"] || GitHub.Config.status_field()
    state_set = MapSet.new(state_names)
    graphql_opts = forward_graphql_opts(opts)

    case fetch_all_project_items(project_id, nil, [], graphql_opts) do
      {:ok, items} ->
        issues =
          items
          |> build_candidate_records(status_field_name)
          |> filter_candidate_records(repo, state_set)

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

  defp build_candidate_records(items, status_field_name) do
    Enum.flat_map(items, fn item ->
      case extract_issue_content(item) do
        {:ok, content} ->
          issue = build_issue_from_content(content, item, status_field_name)
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
      {:ok, content} -> build_issue_from_content(content, item, status_field_name)
      :skip -> nil
    end
  end

  defp build_issue_from_content(content, item, status_field_name) do
    raw_labels = extract_raw_label_names(content)

    %Issue{
      id: content["id"],
      identifier: format_identifier(content["number"]),
      title: content["title"],
      description: content["body"],
      priority: extract_priority_from_labels(raw_labels),
      state: extract_status_value(item, status_field_name),
      branch_name: nil,
      url: content["url"],
      assignee_id: extract_first_assignee_login(content),
      blocked_by: [],
      labels: filter_visible_labels(raw_labels),
      assigned_to_worker: true,
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
    admission = GitHub.Config.admission_label() |> downcase_safe()

    label_names
    |> Enum.map(&String.downcase/1)
    |> Enum.reject(fn label ->
      label == admission or priority_label?(label)
    end)
  end

  defp downcase_safe(nil), do: nil
  defp downcase_safe(value) when is_binary(value), do: String.downcase(value)

  defp priority_label?(label) when is_binary(label) do
    Regex.match?(~r/^priority:\d+$/, label)
  end

  defp extract_priority_from_labels(label_names) do
    Enum.find_value(label_names, fn name ->
      case Regex.run(~r/^priority:(\d+)$/i, name) do
        [_, n] ->
          case Integer.parse(n) do
            {priority, ""} -> priority
            _ -> nil
          end

        _ ->
          nil
      end
    end)
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

  defp format_identifier(number) when is_integer(number), do: Integer.to_string(number)
  defp format_identifier(number) when is_binary(number), do: number
  defp format_identifier(_), do: nil

  # -- by-id helpers -----------------------------------------------------------

  defp do_fetch_issues_by_ids(ids, metadata, repo, opts) do
    project_id = metadata["project_id"]
    status_field_name = metadata["status_field_name"] || GitHub.Config.status_field()
    graphql_opts = forward_graphql_opts(opts)

    case graphql(@issues_by_ids_query, %{"ids" => ids}, graphql_opts) do
      {:ok, %{"data" => %{"nodes" => nodes}}} when is_list(nodes) ->
        issues =
          nodes
          |> Enum.flat_map(fn node ->
            case build_issue_from_node(node, project_id, status_field_name, repo) do
              nil -> []
              issue -> [issue]
            end
          end)

        {:ok, issues}

      {:ok, _body} ->
        {:error, :github_unknown_payload}

      {:error, _} = error ->
        error
    end
  end

  defp build_issue_from_node(%{"__typename" => "Issue"} = node, project_id, status_field_name, repo) do
    if get_in(node, ["repository", "nameWithOwner"]) == repo do
      project_item = find_project_item(node, project_id)

      state =
        case project_item do
          nil -> nil
          item -> extract_status_value(item, status_field_name)
        end

      raw_labels = extract_raw_label_names(node)

      %Issue{
        id: node["id"],
        identifier: format_identifier(node["number"]),
        title: node["title"],
        description: node["body"],
        priority: extract_priority_from_labels(raw_labels),
        state: state,
        branch_name: nil,
        url: node["url"],
        assignee_id: extract_first_assignee_login(node),
        blocked_by: [],
        labels: filter_visible_labels(raw_labels),
        assigned_to_worker: true,
        created_at: parse_datetime(node["createdAt"]),
        updated_at: parse_datetime(node["updatedAt"])
      }
    end
  end

  defp build_issue_from_node(_node, _project_id, _status_field_name, _repo), do: nil

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

  # -- REST helpers (used by update_issue_state and create_comment) ----------

  defp do_update_issue_state(request_fun, token, issue_url, owner, repo, issue_number, prefix, state_name) do
    new_label = "#{prefix}:#{normalize_state(state_name)}"

    case request_fun.(%{method: :get, url: issue_url, token: token}) do
      {:ok, %{status: 200, body: issue_body}} ->
        swap_labels(request_fun, token, owner, repo, issue_number, issue_body, prefix, new_label)
        maybe_close_issue(request_fun, token, issue_url, state_name)
        :ok

      {:ok, %{status: status}} ->
        {:error, {:github_api_status, status}}

      {:error, reason} ->
        {:error, {:github_api_request, reason}}
    end
  end

  defp swap_labels(request_fun, token, owner, repo, issue_number, issue_body, prefix, new_label) do
    issue_body
    |> Map.get("labels", [])
    |> Enum.map(&Map.get(&1, "name", ""))
    |> Enum.filter(&String.starts_with?(&1, "#{prefix}:"))
    |> Enum.each(fn label ->
      url = "#{@base_url}/repos/#{owner}/#{repo}/issues/#{issue_number}/labels/#{URI.encode(label)}"
      request_fun.(%{method: :delete, url: url, token: token})
    end)

    add_url = "#{@base_url}/repos/#{owner}/#{repo}/issues/#{issue_number}/labels"
    request_fun.(%{method: :post, url: add_url, token: token, body: %{"labels" => [new_label]}})
  end

  defp maybe_close_issue(request_fun, token, issue_url, state_name) do
    if normalize_state(state_name) in ["done", "cancelled"] do
      request_fun.(%{method: :patch, url: issue_url, token: token, body: %{"state" => "closed"}})
    end
  end

  defp normalize_state(state_name) do
    state_name
    |> String.trim()
    |> String.downcase()
    |> String.replace(" ", "-")
  end

  defp parse_repo do
    case GitHub.Config.repo() do
      nil ->
        {:error, :missing_github_repo}

      repo_string ->
        case String.split(repo_string, "/") do
          [owner, repo] -> {:ok, {owner, repo}}
          _ -> {:error, {:invalid_github_repo, repo_string}}
        end
    end
  end

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

  defp default_request_fun(%{method: :get, url: url, token: token}) do
    Req.get(url, headers: github_headers(token), connect_options: [timeout: 30_000])
  end

  defp default_request_fun(%{method: :post, url: url, token: token, body: body}) do
    Req.post(url, headers: github_headers(token), json: body, connect_options: [timeout: 30_000])
  end

  defp default_request_fun(%{method: :patch, url: url, token: token, body: body}) do
    Req.patch(url, headers: github_headers(token), json: body, connect_options: [timeout: 30_000])
  end

  defp default_request_fun(%{method: :delete, url: url, token: token}) do
    Req.delete(url, headers: github_headers(token), connect_options: [timeout: 30_000])
  end

  defp github_headers(token) do
    [
      {"Authorization", "Bearer #{token}"},
      {"Accept", "application/vnd.github+json"},
      {"X-GitHub-Api-Version", "2022-11-28"}
    ]
  end

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
