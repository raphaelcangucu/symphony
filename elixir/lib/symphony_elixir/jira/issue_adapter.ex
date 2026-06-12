defmodule SymphonyElixir.Jira.IssueAdapter do
  @moduledoc "JIRA Cloud implementation of `Tracker.IssueAdapter` (UI reads/writes)."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  require Logger

  alias SymphonyElixir.Jira.{Adf, Client, Config, Priority}
  alias SymphonyElixir.Jira.IssueAdapter.{Filter, Query}
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Workpad

  @default_issue_type "Task"
  @search_path "/rest/api/3/search/jql"
  @page_size 100
  @default_max_results 500
  @link_fetch_batch 100

  @impl true
  def kind, do: :jira

  @impl true
  def list_issues(%Project{} = project, _filters) do
    cap = max_results(project)
    fields = list_fields(project)

    with {:ok, primary, related} <-
           search_all(project, Filter.build_jql(project), fields, cap, nil, [], MapSet.new()) do
      {:ok, append_linked(project, primary, related, cap)}
    end
  end

  @impl true
  def get_issue(%Project{} = project, identifier) do
    case request(:get, "/rest/api/3/issue/#{identifier}") do
      {:ok, %{"key" => _} = issue} -> {:ok, Query.normalize_issue(issue, ctx(project))}
      {:ok, _response} -> {:error, :issue_not_found}
      error -> {:error, map_error(error)}
    end
  end

  @doc """
  Fetches just the attachment metadata for an issue.

  Lighter than `get_issue/2`; used to enrich locally-mirrored issues with
  remote-only attachment data on detail reads.
  """
  @spec list_attachments(Project.t(), String.t()) ::
          {:ok, [IssueDTO.attachment()]} | {:error, term()}
  def list_attachments(%Project{} = _project, identifier) do
    case request(:get, "/rest/api/3/issue/#{identifier}?fields=attachment") do
      {:ok, %{"fields" => fields}} when is_map(fields) ->
        {:ok, Query.attachments(fields["attachment"])}

      {:ok, _response} ->
        {:ok, []}

      error ->
        {:error, map_error(error)}
    end
  end

  @impl true
  def list_statuses(%Project{} = project) do
    with {:ok, raw} <- fetch_project_statuses(project) do
      statuses =
        raw
        |> Query.statuses_with_ids()
        |> order_for_board(project)
        |> Query.with_positions()

      {:ok, statuses}
    end
  end

  @impl true
  def list_labels(%Project{} = _project) do
    case request(:get, "/rest/api/3/label") do
      {:ok, response} -> {:ok, Query.labels(response)}
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def list_assignable_users(%Project{} = project) do
    path = "/rest/api/3/user/assignable/search?project=#{project_key(project)}&maxResults=100"

    case request(:get, path) do
      {:ok, response} when is_list(response) -> {:ok, Query.users(response)}
      {:ok, _response} -> {:ok, []}
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def create_issue(%Project{} = project, attrs) when is_map(attrs) do
    with {:ok, title} <- require_title(attrs),
         fields = build_fields(project, title, attrs),
         {:ok, response} <- request(:post, "/rest/api/3/issue", %{"fields" => fields}),
         {:ok, dto} <- Query.created_issue(response, ctx(project), title) do
      {:ok, dto}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def update_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def move_issue(%Project{} = project, identifier, attrs) when is_map(attrs) do
    status = attrs |> Map.get("status") |> trim_string()

    with {:ok, transition_id} <- resolve_transition_id(identifier, status),
         {:ok, _response} <-
           request(:post, "/rest/api/3/issue/#{identifier}/transitions", %{
             "transition" => %{"id" => transition_id}
           }),
         {:ok, dto} <- get_issue(project, identifier) do
      {:ok, dto}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def list_comments(%Project{} = _project, identifier) do
    case request(:get, "/rest/api/3/issue/#{identifier}/comment") do
      {:ok, %{"comments" => comments}} when is_list(comments) ->
        {:ok, Enum.map(comments, &normalize_comment/1)}

      {:ok, _response} ->
        {:ok, []}

      error ->
        {:error, map_error(error)}
    end
  end

  @impl true
  def add_comment(%Project{} = _project, identifier, body, _attrs) when is_binary(body) do
    payload = %{"body" => Adf.from_text(body)}

    case request(:post, "/rest/api/3/issue/#{identifier}/comment", payload) do
      {:ok, %{"id" => _} = comment} -> {:ok, normalize_comment(comment)}
      {:ok, _response} -> {:ok, %{remote_id: nil, body: body, author: nil, remote_updated_at: nil}}
      error -> {:error, map_error(error)}
    end
  end

  @doc """
  Edits an existing JIRA issue comment in place (workpad updates).
  """
  @spec update_comment(Project.t(), String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, term()}
  def update_comment(%Project{} = _project, identifier, remote_id, body) when is_binary(body) do
    payload = %{"body" => Adf.from_text(body)}

    case request(:put, "/rest/api/3/issue/#{identifier}/comment/#{remote_id}", payload) do
      {:ok, %{"id" => _} = comment} -> {:ok, normalize_comment(comment)}
      {:ok, _response} -> {:ok, %{remote_id: remote_id, body: body, author: nil, remote_updated_at: nil}}
      error -> {:error, map_error(error)}
    end
  end

  defp search_all(project, jql, fields, cap, token, acc, related) do
    case request(:post, @search_path, search_body(jql, fields, token)) do
      {:ok, %{"issues" => issues} = response} when is_list(issues) ->
        acc = acc ++ Enum.map(issues, &Query.normalize_issue(&1, ctx(project)))
        related = collect_related(issues, related)

        cond do
          length(acc) >= cap -> {:ok, truncate(project, acc, cap), related}
          last_page?(response) -> {:ok, acc, related}
          true -> search_all(project, jql, fields, cap, response["nextPageToken"], acc, related)
        end

      {:ok, _response} ->
        {:ok, acc, related}

      error ->
        {:error, map_error(error)}
    end
  end

  defp search_body(jql, fields, nil) do
    %{"jql" => jql, "fields" => fields, "maxResults" => @page_size}
  end

  defp search_body(jql, fields, token) do
    jql |> search_body(fields, nil) |> Map.put("nextPageToken", token)
  end

  # Fields requested for the primary board pull. Linked-issue expansion needs the
  # `subtasks`/`issuelinks` of each board issue, so request them only when the
  # project opts in (keeps payloads lean for every other JIRA project).
  defp list_fields(project) do
    if include_linked?(project), do: Query.issue_fields() ++ Query.link_fields(), else: Query.issue_fields()
  end

  defp collect_related(issues, related) do
    Enum.reduce(issues, related, fn issue, set ->
      issue |> Query.linked_keys() |> Enum.reduce(set, &MapSet.put(&2, &1))
    end)
  end

  # Pulls in issues linked to the primary board set (children/links of e.g. a
  # `Product = Inspire` story) that the board filter would otherwise exclude, so
  # a bug linked to an in-scope task still lands on the board. One hop only: the
  # second fetch does not itself expand. Failures degrade to the primary set.
  defp append_linked(project, primary, related, cap) do
    case linked_to_fetch(project, primary, related) do
      [] -> primary
      keys -> merge_capped(project, primary, fetch_linked(project, keys, cap), cap)
    end
  end

  defp linked_to_fetch(project, primary, related) do
    existing = MapSet.new(primary, & &1.identifier)
    prefix = project_key(project) <> "-"

    related
    |> MapSet.difference(existing)
    |> Enum.filter(&String.starts_with?(&1, prefix))
    |> Enum.sort()
  end

  defp fetch_linked(project, keys, cap) do
    keys
    |> Enum.chunk_every(@link_fetch_batch)
    |> Enum.flat_map(fn chunk ->
      case search_all(project, Filter.keys_jql(project, chunk), Query.issue_fields(), cap, nil, [], MapSet.new()) do
        {:ok, dtos, _related} ->
          dtos

        {:error, reason} ->
          Logger.warning("jira linked-issue expansion failed project=#{project.slug} reason=#{inspect(reason)}")
          []
      end
    end)
  end

  defp merge_capped(project, primary, extra, cap) do
    existing = MapSet.new(primary, & &1.identifier)
    additions = Enum.reject(extra, &MapSet.member?(existing, &1.identifier))
    combined = primary ++ additions

    if length(combined) > cap, do: truncate(project, combined, cap), else: combined
  end

  defp include_linked?(%Project{tracker_config: config}) do
    case Map.get(config, "include_linked_issues") do
      true -> true
      "true" -> true
      _ -> false
    end
  end

  defp last_page?(%{"isLast" => true}), do: true
  defp last_page?(%{"nextPageToken" => token}) when is_binary(token) and token != "", do: false
  defp last_page?(_response), do: true

  defp truncate(project, issues, cap) do
    Logger.warning("jira board pull truncated project=#{project.slug} cap=#{cap}")
    Enum.take(issues, cap)
  end

  defp fetch_project_statuses(%Project{} = project) do
    case request(:get, "/rest/api/3/project/#{project_key(project)}/statuses") do
      {:ok, response} when is_list(response) -> {:ok, response}
      {:ok, _response} -> {:ok, []}
      error -> {:error, map_error(error)}
    end
  end

  # Orders the project statuses to match the JIRA board's columns (left→right),
  # so the local board mirrors the team's board. Falls back to the project-status
  # order when no `board_id` is configured or the board config can't be fetched.
  defp order_for_board(statuses, %Project{} = project) do
    case board_status_ids(project) do
      [] -> statuses
      ordered_ids -> Query.reorder_by_ids(statuses, ordered_ids)
    end
  end

  defp board_status_ids(%Project{} = project) do
    case board_id(project) do
      nil ->
        []

      id ->
        case request(:get, "/rest/agile/1.0/board/#{id}/configuration") do
          {:ok, %{"columnConfig" => %{"columns" => columns}}} when is_list(columns) ->
            Enum.flat_map(columns, fn column ->
              column
              |> Map.get("statuses")
              |> List.wrap()
              |> Enum.map(&to_string(&1["id"]))
            end)

          _ ->
            []
        end
    end
  end

  defp board_id(%Project{tracker_config: config}) do
    case Map.get(config, "board_id") do
      value when is_integer(value) and value > 0 ->
        value

      value when is_binary(value) ->
        case Integer.parse(value) do
          {parsed, _rest} when parsed > 0 -> parsed
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp max_results(%Project{tracker_config: config}) do
    case Map.get(config, "max_results") do
      value when is_integer(value) and value > 0 -> value
      _ -> @default_max_results
    end
  end

  defp ctx(%Project{} = project) do
    %{project_slug: project.slug, base_url: Config.base_url()}
  end

  defp project_key(%Project{tracker_config: config}), do: Map.fetch!(config, "project_key")

  defp issue_type(%Project{tracker_config: config}) do
    case config |> Map.get("issue_type") |> trim_string() do
      "" -> @default_issue_type
      value -> value
    end
  end

  defp require_title(attrs) do
    case attrs |> Map.get("title") |> trim_string() do
      "" -> {:error, {:remote_validation, %{title: ["is required"]}}}
      title -> {:ok, title}
    end
  end

  defp build_fields(%Project{} = project, title, attrs) do
    %{
      "project" => %{"key" => project_key(project)},
      "issuetype" => %{"name" => issue_type(project)},
      "summary" => title
    }
    |> put_present("description", description(attrs))
    |> put_present("assignee", assignee_field(attrs))
    |> put_present("priority", priority_field(attrs))
    |> put_labels(labels(project, attrs))
  end

  defp description(attrs) do
    case attrs |> Map.get("description") |> trim_string() do
      "" -> nil
      value -> Adf.from_text(value)
    end
  end

  defp assignee_field(attrs) do
    case attrs |> Map.get("assignee_ids") |> string_list() |> List.first() do
      nil -> nil
      account_id -> %{"accountId" => account_id}
    end
  end

  defp priority_field(attrs) do
    case Priority.to_name(Map.get(attrs, "priority")) do
      nil -> nil
      name -> %{"name" => name}
    end
  end

  defp labels(_project, attrs) do
    base = string_list(Map.get(attrs, "labels")) ++ string_list(Map.get(attrs, "label_ids"))

    case Map.get(attrs, "agent") do
      agent when agent in ["codex", "claude", "cursor"] -> Enum.uniq(base ++ ["symphony:#{agent}"])
      _ -> Enum.uniq(base)
    end
  end

  defp resolve_transition_id(_identifier, ""), do: {:error, :status_not_found}

  defp resolve_transition_id(identifier, status) do
    case request(:get, "/rest/api/3/issue/#{identifier}/transitions") do
      {:ok, %{"transitions" => transitions}} when is_list(transitions) ->
        transitions
        |> Enum.find(fn transition -> get_in(transition, ["to", "name"]) == status end)
        |> case do
          %{"id" => id} when is_binary(id) -> {:ok, id}
          _ -> {:error, :status_not_found}
        end

      {:ok, _response} ->
        {:error, :status_not_found}

      error ->
        error
    end
  end

  defp normalize_comment(comment) do
    body = Adf.to_text(comment["body"])

    %{
      remote_id: comment["id"],
      body: body,
      kind: Workpad.classify(body),
      author: get_in(comment, ["author", "displayName"]),
      remote_updated_at: comment["updated"]
    }
  end

  defp request(verb, path, body \\ nil) do
    client().request(verb, path, body, [])
  end

  defp client, do: Application.get_env(:symphony_elixir, :jira_client_module, Client)

  defp put_present(map, _key, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp put_labels(map, []), do: map
  defp put_labels(map, labels), do: Map.put(map, "labels", labels)

  defp string_list(value) when is_list(value), do: Enum.filter(value, &(is_binary(&1) and &1 != ""))
  defp string_list(_value), do: []

  defp trim_string(value) when is_binary(value), do: String.trim(value)
  defp trim_string(_value), do: ""

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error({:remote_validation, _details} = error), do: error
  defp map_error(:issue_not_found), do: :issue_not_found
  defp map_error(:status_not_found), do: :status_not_found
  defp map_error(:create_failed), do: :remote_unavailable
  defp map_error({:jira_api_status, 400}), do: {:remote_validation, %{}}
  defp map_error({:jira_api_status, 401}), do: :remote_unauthorized
  defp map_error({:jira_api_status, 403}), do: :remote_forbidden
  defp map_error({:jira_api_status, 404}), do: :issue_not_found
  defp map_error({:jira_api_status, 429}), do: :remote_rate_limited
  defp map_error({:jira_api_status, status}) when status in 500..599, do: :remote_unavailable
  defp map_error(_reason), do: :remote_unavailable
end
