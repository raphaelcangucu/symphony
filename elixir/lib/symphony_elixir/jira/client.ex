defmodule SymphonyElixir.Jira.Client do
  @moduledoc """
  Thin JIRA Cloud REST (API v3) client.

  Exposes a low-level `request/4` used by `Jira.Tracker` and `Jira.IssueAdapter`,
  plus the orchestrator poll helpers that map JQL search results to
  `SymphonyElixir.Issue` structs. HTTP is performed with `Req` but can be
  injected via the `:request_fun` option for tests.
  """

  require Logger

  alias SymphonyElixir.{Config, Issue, Jira}

  @max_error_body_log_bytes 1_000
  @request_timeout_ms 30_000
  @search_page_size 50
  @search_path "/rest/api/3/search/jql"
  @myself_path "/rest/api/3/myself"
  @search_fields ~w(summary description status assignee priority labels issuelinks created updated)
  @blocked_by_link "is blocked by"

  @typep verb :: :get | :post | :put | :delete
  @typep assignee_filter :: %{match_values: MapSet.t()} | nil

  @doc """
  Performs a JIRA REST request and returns the decoded body on success.

  Options:
    * `:request_fun` — `fn verb, url, body, headers -> {:ok, %{status, body}} | {:error, reason}`
    * `:base_url`, `:email`, `:api_token` — override `Jira.Config` (used by tests)
  """
  @spec request(verb(), String.t(), map() | nil, keyword()) :: {:ok, term()} | {:error, term()}
  def request(verb, path, body, opts \\ [])
      when verb in [:get, :post, :put, :delete] and is_binary(path) and is_list(opts) do
    base_url = Keyword.get(opts, :base_url, Jira.Config.base_url())
    email = Keyword.get(opts, :email, Jira.Config.email())
    api_token = Keyword.get(opts, :api_token, Jira.Config.api_token())

    with {:ok, headers} <- auth_headers(email, api_token),
         {:ok, url} <- build_url(base_url, path) do
      request_fun = Keyword.get(opts, :request_fun, &default_request/4)

      case request_fun.(verb, url, body, headers) do
        {:ok, %{status: status, body: response_body}} when status in 200..299 ->
          {:ok, response_body}

        {:ok, %{status: status} = response} ->
          Logger.error("JIRA request failed status=#{status} path=#{path}" <> error_context(response))
          {:error, {:jira_api_status, status}}

        {:error, reason} ->
          Logger.error("JIRA request failed path=#{path}: #{inspect(reason)}")
          {:error, {:jira_api_request, reason}}
      end
    end
  end

  @doc """
  Resolves the authenticated JIRA user via `/rest/api/3/myself`.

  Returns the canonical `accountId` plus display name and email for operator
  identity surfaces and assignee matching.
  """
  @spec viewer(keyword()) :: {:ok, map()} | {:error, term()}
  def viewer(opts \\ []) when is_list(opts) do
    case request(:get, @myself_path, nil, opts) do
      {:ok, %{"accountId" => account_id} = body} when is_binary(account_id) and account_id != "" ->
        {:ok,
         %{
           account_id: account_id,
           display_name: present(body["displayName"]),
           email: present(body["emailAddress"])
         }}

      {:ok, _body} ->
        {:error, :missing_jira_viewer_identity}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec fetch_candidate_issues(keyword()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_candidate_issues(opts \\ []) when is_list(opts) do
    project_key = Keyword.get(opts, :project_key, Jira.Config.project_key())
    api_token = Keyword.get(opts, :api_token, Jira.Config.api_token())

    cond do
      is_nil(api_token) ->
        {:error, :missing_jira_credentials}

      is_nil(project_key) ->
        {:error, :missing_project_key}

      true ->
        with {:ok, assignee_filter} <- routing_assignee_filter(opts) do
          states = Keyword.get(opts, :active_states, Config.active_states())
          jql = build_jql(project_key, states, assignee_filter)
          search_all(jql, assignee_filter, opts)
        end
    end
  end

  @spec fetch_issues_by_states([String.t()], keyword()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(state_names, opts \\ []) when is_list(state_names) and is_list(opts) do
    states = state_names |> Enum.map(&to_string/1) |> Enum.uniq()
    project_key = Keyword.get(opts, :project_key, Jira.Config.project_key())
    api_token = Keyword.get(opts, :api_token, Jira.Config.api_token())

    cond do
      states == [] ->
        {:ok, []}

      is_nil(api_token) ->
        {:error, :missing_jira_credentials}

      is_nil(project_key) ->
        {:error, :missing_project_key}

      true ->
        jql = build_jql(project_key, states, nil)
        search_all(jql, nil, opts)
    end
  end

  @spec fetch_issue_states_by_ids([String.t()], keyword()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issue_states_by_ids(issue_ids, opts \\ []) when is_list(issue_ids) and is_list(opts) do
    ids = issue_ids |> Enum.map(&to_string/1) |> Enum.reject(&(&1 == "")) |> Enum.uniq()
    api_token = Keyword.get(opts, :api_token, Jira.Config.api_token())

    cond do
      ids == [] ->
        {:ok, []}

      is_nil(api_token) ->
        {:error, :missing_jira_credentials}

      true ->
        jql = "id in (" <> Enum.join(ids, ", ") <> ")"
        search_all(jql, nil, opts)
    end
  end

  @doc false
  @spec normalize_issue_for_test(map(), String.t() | nil) :: Issue.t() | nil
  def normalize_issue_for_test(issue, assignee \\ nil) when is_map(issue) do
    filter =
      case assignee do
        value when is_binary(value) and value != "" -> %{match_values: MapSet.new([value])}
        _ -> nil
      end

    normalize_issue(issue, filter, nil)
  end

  defp search_all(jql, assignee_filter, opts) do
    base_url = Keyword.get(opts, :base_url, Jira.Config.base_url())
    search_page(jql, assignee_filter, base_url, opts, nil, [])
  end

  defp search_page(jql, assignee_filter, base_url, opts, next_token, acc) do
    body = search_body(jql, next_token)

    with {:ok, response} <- request(:post, @search_path, body, opts),
         {:ok, issues, token, last?} <- decode_search(response, assignee_filter, base_url) do
      updated = Enum.reverse(issues, acc)

      if last? or is_nil(token) do
        {:ok, Enum.reverse(updated)}
      else
        search_page(jql, assignee_filter, base_url, opts, token, updated)
      end
    end
  end

  defp search_body(jql, nil) do
    %{"jql" => jql, "fields" => @search_fields, "maxResults" => @search_page_size}
  end

  defp search_body(jql, next_token) do
    jql |> search_body(nil) |> Map.put("nextPageToken", next_token)
  end

  defp decode_search(%{"issues" => issues} = body, assignee_filter, base_url) when is_list(issues) do
    normalized =
      issues
      |> Enum.map(&normalize_issue(&1, assignee_filter, base_url))
      |> Enum.reject(&is_nil/1)

    {:ok, normalized, body["nextPageToken"], body["isLast"] == true}
  end

  defp decode_search(_body, _assignee_filter, _base_url), do: {:error, :jira_unknown_payload}

  defp normalize_issue(%{"id" => id, "key" => key} = issue, assignee_filter, base_url)
       when is_binary(id) and is_binary(key) do
    fields = Map.get(issue, "fields") || %{}
    assignee = fields["assignee"]

    %Issue{
      id: id,
      identifier: key,
      title: fields["summary"],
      description: Jira.Adf.to_text(fields["description"]),
      priority: Jira.Priority.to_int(get_in(fields, ["priority", "name"])),
      state: get_in(fields, ["status", "name"]),
      branch_name: nil,
      url: browse_url(base_url, key),
      assignee_id: account_id(assignee),
      blocked_by: extract_blockers(fields["issuelinks"]),
      labels: extract_labels(fields["labels"]),
      assigned_to_worker: assigned_to_worker?(assignee, assignee_filter),
      created_at: parse_datetime(fields["created"]),
      updated_at: parse_datetime(fields["updated"])
    }
  end

  defp normalize_issue(_issue, _assignee_filter, _base_url), do: nil

  defp build_jql(project_key, states, assignee_filter) do
    [
      "project = #{quote_jql(project_key)}",
      states_clause(states),
      assignee_clause(assignee_filter)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join(" AND ")
  end

  defp states_clause(states) when is_list(states) do
    case Enum.reject(states, &(&1 in [nil, ""])) do
      [] -> nil
      list -> "status in (" <> Enum.map_join(list, ", ", &quote_jql/1) <> ")"
    end
  end

  defp states_clause(_states), do: nil

  defp assignee_clause(%{match_values: match_values}) do
    case MapSet.to_list(match_values) do
      [account_id | _] -> "assignee = #{quote_jql(account_id)}"
      _ -> nil
    end
  end

  defp assignee_clause(_assignee_filter), do: nil

  defp quote_jql(value) do
    "\"" <> (value |> to_string() |> String.replace("\"", "\\\"")) <> "\""
  end

  @spec routing_assignee_filter(keyword()) :: {:ok, assignee_filter()} | {:error, term()}
  defp routing_assignee_filter(opts) do
    case Keyword.get(opts, :assignee, Jira.Config.assignee()) do
      value when is_binary(value) ->
        build_assignee_filter(String.trim(value), opts)

      _ ->
        {:ok, nil}
    end
  end

  defp build_assignee_filter("", _opts), do: {:ok, nil}

  defp build_assignee_filter("me", opts) do
    case request(:get, @myself_path, nil, opts) do
      {:ok, %{"accountId" => account_id}} when is_binary(account_id) ->
        {:ok, %{match_values: MapSet.new([account_id])}}

      {:ok, _body} ->
        {:error, :missing_jira_viewer_identity}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_assignee_filter(account_id, _opts) do
    {:ok, %{match_values: MapSet.new([account_id])}}
  end

  defp assigned_to_worker?(_assignee, nil), do: true

  defp assigned_to_worker?(assignee, %{match_values: match_values}) do
    case account_id(assignee) do
      nil -> false
      id -> MapSet.member?(match_values, id)
    end
  end

  defp account_id(%{"accountId" => id}) when is_binary(id), do: id
  defp account_id(_assignee), do: nil

  defp extract_labels(labels) when is_list(labels) do
    labels
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.downcase/1)
  end

  defp extract_labels(_labels), do: []

  defp extract_blockers(links) when is_list(links) do
    Enum.flat_map(links, fn
      %{"type" => %{"inward" => @blocked_by_link}, "inwardIssue" => %{} = blocker} ->
        [
          %{
            id: blocker["id"],
            identifier: blocker["key"],
            state: get_in(blocker, ["fields", "status", "name"])
          }
        ]

      _ ->
        []
    end)
  end

  defp extract_blockers(_links), do: []

  defp browse_url(base_url, key) when is_binary(base_url) and is_binary(key) do
    String.trim_trailing(base_url, "/") <> "/browse/" <> key
  end

  defp browse_url(_base_url, _key), do: nil

  defp parse_datetime(nil), do: nil

  defp parse_datetime(raw) when is_binary(raw) do
    case DateTime.from_iso8601(raw) do
      {:ok, dt, _offset} ->
        dt

      _ ->
        case DateTime.from_iso8601(normalize_offset(raw)) do
          {:ok, dt, _offset} -> dt
          _ -> nil
        end
    end
  end

  defp parse_datetime(_raw), do: nil

  defp normalize_offset(raw) do
    Regex.replace(~r/([+-]\d{2})(\d{2})$/, raw, "\\1:\\2")
  end

  defp auth_headers(email, api_token) when is_binary(email) and is_binary(api_token) do
    token = Base.encode64("#{email}:#{api_token}")

    {:ok,
     [
       {"Authorization", "Basic #{token}"},
       {"Content-Type", "application/json"},
       {"Accept", "application/json"}
     ]}
  end

  defp auth_headers(_email, _api_token), do: {:error, :missing_jira_credentials}

  defp build_url(base_url, path) when is_binary(base_url) and is_binary(path) do
    {:ok, String.trim_trailing(base_url, "/") <> path}
  end

  defp build_url(_base_url, _path), do: {:error, :missing_jira_credentials}

  defp default_request(verb, url, nil, headers) do
    Req.request(method: verb, url: url, headers: headers, connect_options: [timeout: @request_timeout_ms])
  end

  defp default_request(verb, url, body, headers) do
    Req.request(
      method: verb,
      url: url,
      headers: headers,
      json: body,
      connect_options: [timeout: @request_timeout_ms]
    )
  end

  defp error_context(%{body: body}), do: " body=" <> summarize_error_body(body)
  defp error_context(_response), do: ""

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

  defp present(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp present(_value), do: nil
end
