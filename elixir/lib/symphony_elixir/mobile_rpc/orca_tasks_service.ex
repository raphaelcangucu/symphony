defmodule SymphonyElixir.MobileRpc.OrcaTasksService do
  @moduledoc """
  Presents native Symphony projects and issues to the copied Orca Tasks surface.

  Provider-specific data remains provider-specific: this service never labels a
  Symphony issue as GitHub, GitLab or Linear.
  """

  alias SymphonyElixir.MobileRpc.{NotificationSubscription, TrackerBridge}
  alias SymphonyElixirWeb.Presenter

  @default_limit 200
  @max_limit 500

  @spec call(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def call("symphony.tasks.list", params, context) do
    with {:ok, projects_payload} <- request(:projects, "GET", "/projects", nil, context) do
      projects =
        projects_payload
        |> data()
        |> list()
        |> select_projects(Map.get(params, "projectSlugs"))

      query = normalize_query(Map.get(params, "query"))
      limit = bounded_limit(Map.get(params, "limit", @default_limit))
      agent_states = agent_states()

      all_items =
        projects
        |> Enum.flat_map(&project_items(&1, query, context, agent_states))
        |> Enum.sort_by(&Map.get(&1, "updatedAt", ""), :desc)

      {:ok,
       %{
         "items" => Enum.take(all_items, limit),
         "totalCount" => length(all_items),
         "provider" => "symphony"
       }}
    end
  end

  def call(
        "symphony.tasks.get",
        %{"projectSlug" => project_slug, "identifier" => identifier},
        context
      ) do
    encoded_project = URI.encode(project_slug)
    encoded_identifier = URI.encode(identifier)
    base = "/projects/#{encoded_project}/issues/#{encoded_identifier}"

    with {:ok, issue_payload} <- request(:tasks, "GET", base, nil, context) do
      issue = data(issue_payload)

      {:ok,
       issue
       |> stringify_keys()
       |> Map.put("comments", related_list(context, "#{base}/comments"))
       |> Map.put("blockers", related_list(context, "#{base}/blockers"))
       |> Map.put("subtasks", related_list(context, "#{base}/subtasks"))}
    end
  end

  def call(
        "notifications.unsubscribe",
        %{"subscriptionId" => subscription_id},
        _context
      ) do
    # The transport unsubscribe envelope owns cleanup. This copied Orca method
    # remains an idempotent compatibility acknowledgement.
    {:ok, %{"unsubscribed" => true, "subscriptionId" => subscription_id}}
  end

  def call(_method, _params, _context), do: {:error, :unsupported_orca_tasks_method}

  @spec subscribe(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def subscribe("notifications.subscribe", %{}, context) do
    NotificationSubscription.subscribe(
      connection_pid: Map.fetch!(context, :connection_pid),
      subscription_id:
        "notifications:#{Map.fetch!(context, :host_id)}:#{Map.fetch!(context, :device_id)}:" <>
          Integer.to_string(System.unique_integer([:positive])),
      host_id: Map.fetch!(context, :host_id)
    )
  end

  def subscribe(_method, _params, _context), do: {:error, :unsupported_subscription}

  defp project_items(project, query, context, agent_states) do
    slug = value(project, "slug")

    if is_binary(slug) and slug != "" do
      path =
        case query do
          nil -> "/projects/#{URI.encode(slug)}/issues"
          text -> "/projects/#{URI.encode(slug)}/issues?q=#{URI.encode_www_form(text)}"
        end

      case request(:tasks, "GET", path, nil, context) do
        {:ok, payload} ->
          payload
          |> data()
          |> list()
          |> Enum.map(&present_item(&1, project, agent_states))

        {:error, _reason} ->
          []
      end
    else
      []
    end
  end

  defp present_item(issue, project, agent_states) do
    identifier = value(issue, "identifier")
    agent_state = Map.get(agent_states, identifier, %{})
    last_event = value(agent_state, "last_event")

    %{
      "id" => to_string(value(issue, "id") || identifier || ""),
      "identifier" => identifier,
      "title" => value(issue, "title") || identifier || "Untitled task",
      "description" => value(issue, "description") || "",
      "projectSlug" => value(issue, "project_slug") || value(project, "slug"),
      "projectName" => value(project, "name") || value(project, "slug"),
      "status" => status_name(value(issue, "status")),
      "updatedAt" => value(issue, "updated_at") || value(issue, "inserted_at") || "",
      "agent" => value(issue, "agent_kind"),
      "agentState" => value(agent_state, "status") || "idle",
      "blockedBy" => blocker_identifiers(value(issue, "blocked_by")),
      "subtaskCount" => subtask_count(value(issue, "sub_issue_summary")),
      "pendingApproval" => attention_event?(last_event, "approval"),
      "pendingQuestion" =>
        attention_event?(last_event, "user_input") or
          attention_event?(last_event, "question"),
      "url" => value(issue, "url")
    }
  end

  defp related_list(context, path) do
    case request(:tasks, "GET", path, nil, context) do
      {:ok, payload} -> payload |> data() |> list() |> Enum.map(&stringify_keys/1)
      {:error, _reason} -> []
    end
  end

  defp request(domain, method, path, body, context) do
    TrackerBridge.request(
      domain,
      %{
        "method" => method,
        "path" => path,
        "body" => body,
        "idempotency_key" => nil
      },
      context
    )
  end

  defp agent_states do
    case Presenter.state_payload(SymphonyElixir.Orchestrator, 1_000) do
      %{"running" => running, "retrying" => retrying} ->
        index_agent_states(running, retrying)

      %{running: running, retrying: retrying} ->
        index_agent_states(running, retrying)

      _unavailable ->
        %{}
    end
  rescue
    _error -> %{}
  end

  defp index_agent_states(running, retrying) do
    running_entries =
      list(running)
      |> Map.new(fn entry ->
        {value(entry, "issue_identifier"), Map.put(stringify_keys(entry), "status", "live")}
      end)

    list(retrying)
    |> Enum.reduce(running_entries, fn entry, acc ->
      Map.put_new(
        acc,
        value(entry, "issue_identifier"),
        Map.put(stringify_keys(entry), "status", "retrying")
      )
    end)
  end

  defp select_projects(projects, slugs) when is_list(slugs) do
    selected = MapSet.new(Enum.filter(slugs, &is_binary/1))
    Enum.filter(projects, &MapSet.member?(selected, value(&1, "slug")))
  end

  defp select_projects(projects, _slugs), do: projects

  defp normalize_query(query) when is_binary(query) do
    case String.trim(query) do
      "" -> nil
      value -> value
    end
  end

  defp normalize_query(_query), do: nil

  defp bounded_limit(value) when is_integer(value),
    do: value |> max(1) |> min(@max_limit)

  defp bounded_limit(_value), do: @default_limit

  defp blocker_identifiers(blockers) do
    blockers
    |> list()
    |> Enum.flat_map(fn
      blocker when is_binary(blocker) -> [blocker]
      blocker when is_map(blocker) -> List.wrap(value(blocker, "identifier"))
      _other -> []
    end)
    |> Enum.filter(&(is_binary(&1) and &1 != ""))
  end

  defp subtask_count(summary) when is_map(summary) do
    value(summary, "total") || value(summary, "count") || 0
  end

  defp subtask_count(_summary), do: 0

  defp attention_event?(event, needle) when is_binary(event),
    do: event |> String.downcase() |> String.contains?(needle)

  defp attention_event?(event, needle) when is_atom(event),
    do: event |> Atom.to_string() |> attention_event?(needle)

  defp attention_event?(_event, _needle), do: false

  defp status_name(%{} = status), do: value(status, "name") || "Unknown"
  defp status_name(status) when is_binary(status), do: status
  defp status_name(_status), do: "Unknown"

  defp data(payload), do: value(payload, "data")
  defp list(value) when is_list(value), do: value
  defp list(_value), do: []

  defp value(map, key) when is_map(map) do
    Map.get(map, key) ||
      Enum.find_value(map, fn {candidate, value} ->
        if to_string(candidate) == key, do: value
      end)
  end

  defp value(_map, _key), do: nil

  defp stringify_keys(map) when is_map(map),
    do: Map.new(map, fn {key, value} -> {to_string(key), value} end)

  defp stringify_keys(value), do: value
end
