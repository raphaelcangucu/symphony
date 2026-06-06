defmodule SymphonyElixir.GitHub.IssueAdapter do
  @moduledoc "GitHub Project v2 implementation of `Tracker.IssueAdapter` (UI reads/writes)."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.GitHub.IssueAdapter.Query
  alias SymphonyElixir.GitHub.IssueComments
  alias SymphonyElixir.GitHub.RepoSpec
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  @page_size 50
  @agent_kinds ["codex", "claude"]

  @impl true
  def kind, do: :github

  @impl true
  def list_issues(%Project{} = project, _filters) do
    %{project_id: project_id, status_field: status_field} = config(project)

    case fetch_all_items(project_id, nil, []) do
      {:ok, nodes} ->
        issues =
          nodes
          |> Enum.map(&Query.normalize_item(&1, status_field, project.slug))
          |> Enum.reject(&is_nil/1)

        {:ok, issues}

      error ->
        {:error, map_error(error)}
    end
  end

  # Walks every page of the project's items (the board can exceed one `@page_size`
  # page). A single page is the common case and costs one request, so this does
  # not add calls to the hot path; it only follows the cursor when there is more.
  defp fetch_all_items(project_id, after_cursor, acc) do
    variables = %{"projectId" => project_id, "first" => @page_size, "after" => after_cursor}

    case client().graphql(Query.list_items_query(), variables, []) do
      {:ok, response} ->
        nodes = response |> get_in(["data", "node", "items", "nodes"]) |> List.wrap()

        case get_in(response, ["data", "node", "items", "pageInfo"]) do
          %{"hasNextPage" => true, "endCursor" => cursor} when is_binary(cursor) and cursor != "" ->
            fetch_all_items(project_id, cursor, acc ++ nodes)

          _ ->
            {:ok, acc ++ nodes}
        end

      error ->
        error
    end
  end

  @impl true
  def get_issue(%Project{} = project, identifier) do
    with {:ok, issues} <- list_issues(project, []) do
      case Enum.find(issues, &(&1.identifier == identifier)) do
        nil -> {:error, :issue_not_found}
        dto -> {:ok, dto}
      end
    end
  end

  @impl true
  def list_statuses(%Project{} = project) do
    %{project_id: project_id} = config(project)

    case client().graphql(Query.status_options_query(), %{"projectId" => project_id}, []) do
      {:ok, response} -> {:ok, Query.status_options(response)}
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def list_labels(%Project{} = project) do
    with {:ok, {owner, name}} <- RepoSpec.split(config(project).repo),
         {:ok, %{labels: labels}} <- fetch_repo_metadata(owner, name) do
      {:ok, labels}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def list_assignable_users(%Project{} = project) do
    with {:ok, {owner, name}} <- RepoSpec.split(config(project).repo),
         {:ok, response} <-
           client().graphql(Query.assignable_users_query(), %{"owner" => owner, "name" => name}, []) do
      {:ok, Query.assignable_users(response)}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def create_issue(%Project{} = project, attrs) when is_map(attrs) do
    cfg = config(project)

    with {:ok, {owner, name}} <- RepoSpec.split(cfg.repo),
         {:ok, title} <- require_title(attrs),
         {:ok, meta} <- fetch_repo_metadata(owner, name),
         label_ids = resolve_label_ids(meta.labels, attrs),
         {:ok, status_target} <- resolve_status_target(cfg, status_name(attrs)),
         {:ok, issue} <- create_remote_issue(meta.repo_id, title, attrs, label_ids),
         {:ok, item_id} <- add_to_project(cfg.project_id, issue["id"]),
         :ok <- apply_status_target(cfg, item_id, status_target) do
      {:ok, build_created_dto(issue, project, attrs, meta.labels, label_ids)}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def update_issue(%Project{} = project, identifier, attrs) when is_map(attrs) do
    %{repo: repo} = config(project)

    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier),
         {:ok, issue} <- fetch_issue_details(owner, name, number),
         {:ok, meta} <- fetch_repo_metadata(owner, name),
         {:ok, _} <- maybe_update_issue_content(project, issue, attrs),
         :ok <- maybe_sync_issue_labels(issue, meta.labels, attrs) do
      get_issue(project, identifier)
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def move_issue(%Project{} = project, identifier, attrs) do
    %{project_id: project_id, status_field: status_field} = config(project)
    target_status = Map.get(attrs, "status") || Map.get(attrs, "state") || Map.get(attrs, :status)

    with {:ok, item_id} <- resolve_move_item_id(project, project_id, identifier, attrs),
         {:ok, fields_response} <-
           client().graphql(Query.status_options_query(), %{"projectId" => project_id}, []),
         {:ok, field_id, option_id} <-
           Query.resolve_field_and_option(fields_response, status_field, target_status),
         {:ok, _} <-
           client().graphql(
             Query.update_field_value_mutation(),
             %{
               "projectId" => project_id,
               "itemId" => item_id,
               "fieldId" => field_id,
               "optionId" => option_id
             },
             []
           ),
         :ok <- maybe_apply_agent_routing_label(project, identifier, attrs) do
      {:ok,
       IssueDTO.build(%{
         identifier: identifier,
         title: target_status,
         status: %{
           name: target_status,
           category: Query.category_for(target_status),
           position: nil,
           is_terminal: false
         },
         project_slug: project.slug
       })}
    else
      {:error, :status_not_found} -> {:error, :status_not_found}
      error -> {:error, map_error(error)}
    end
  end

  @spec archive_issue(Project.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def archive_issue(%Project{} = project, identifier) do
    archive_project_item(project, identifier, Query.archive_project_item_mutation())
  end

  @spec restore_issue(Project.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def restore_issue(%Project{} = project, identifier) do
    archive_project_item(project, identifier, Query.unarchive_project_item_mutation())
  end

  @spec delete_issue(Project.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def delete_issue(%Project{} = project, identifier) do
    %{project_id: project_id} = config(project)

    with {:ok, item_id} <- resolve_move_item_id(project, project_id, identifier, %{}),
         {:ok, response} <-
           client().graphql(
             Query.delete_project_item_mutation(),
             %{"projectId" => project_id, "itemId" => item_id},
             []
           ),
         {:ok, deleted_id} <- Query.deleted_project_item_id(response) do
      {:ok, deleted_id}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  defp archive_project_item(%Project{} = project, identifier, mutation) do
    %{project_id: project_id} = config(project)

    with {:ok, item_id} <- resolve_move_item_id(project, project_id, identifier, %{}),
         {:ok, response} <-
           client().graphql(
             mutation,
             %{"projectId" => project_id, "itemId" => item_id},
             []
           ),
         {:ok, archived_id} <- Query.archived_project_item_id(response) do
      {:ok, archived_id}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def list_comments(%Project{} = project, identifier) do
    case config(project) do
      %{repo: repo} when is_binary(repo) and repo != "" ->
        case IssueComments.for_issue(repo, identifier) do
          {:ok, comments} -> {:ok, comments}
          {:error, {:invalid_issue_identifier, _}} -> {:ok, []}
          error -> {:error, map_error(error)}
        end

      _ ->
        {:error, :not_supported_on_remote}
    end
  end

  @impl true
  def add_comment(%Project{} = project, identifier, body, _attrs) do
    case config(project) do
      %{repo: repo} when is_binary(repo) and repo != "" ->
        case IssueComments.create(repo, identifier, body) do
          {:ok, comment} -> {:ok, comment}
          error -> {:error, map_error(error)}
        end

      _ ->
        {:error, :not_supported_on_remote}
    end
  end

  defp config(%Project{tracker_config: cfg}) do
    %{
      project_id: Map.fetch!(cfg, "project_id"),
      repo: Map.get(cfg, "repo"),
      status_field: Map.get(cfg, "status_field", "Status")
    }
  end

  defp fetch_repo_metadata(owner, name) do
    case client().graphql(Query.repo_metadata_query(), %{"owner" => owner, "name" => name}, []) do
      {:ok, response} ->
        case Query.repository_id(response) do
          {:ok, repo_id} -> {:ok, %{repo_id: repo_id, labels: Query.labels(response)}}
          {:error, _} = error -> error
        end

      {:error, _} = error ->
        error
    end
  end

  defp require_title(attrs) do
    case attrs |> Map.get("title") |> trim_string() do
      "" -> {:error, {:remote_validation, %{title: ["is required"]}}}
      title -> {:ok, title}
    end
  end

  defp resolve_label_ids(labels, attrs) do
    by_name = Map.new(labels, fn label -> {String.downcase(label.name || ""), label.id} end)

    (string_list(Map.get(attrs, "label_ids")) ++
       agent_label_ids(by_name, Map.get(attrs, "agent")) ++
       priority_label_ids(by_name, Map.get(attrs, "priority")))
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp agent_label_ids(by_name, agent) when agent in @agent_kinds do
    case Map.get(by_name, "symphony:" <> agent) do
      id when is_binary(id) -> [id]
      _ -> []
    end
  end

  defp agent_label_ids(_by_name, _agent), do: []

  # Applies the `symphony:<agent>` routing label so the orchestrator admits the
  # issue and resolves the coding agent. GitHub `move_issue` only updates the
  # Status field, so without this an assistant dispatch never enters observability.
  defp maybe_apply_agent_routing_label(%Project{} = project, identifier, attrs) do
    case normalize_agent_kind(Map.get(attrs, "agent") || Map.get(attrs, :agent)) do
      nil -> :ok
      agent -> apply_agent_routing_label(project, identifier, agent)
    end
  end

  defp apply_agent_routing_label(%Project{} = project, identifier, agent) do
    label_name = "symphony:" <> agent

    with {:ok, {owner, name}} <- RepoSpec.split(config(project).repo),
         {:ok, number} <- parse_issue_number(identifier),
         {:ok, issue_node_id} <- fetch_issue_node_id(owner, name, number),
         {:ok, meta} <- fetch_repo_metadata(owner, name),
         {:ok, label_id} <- find_label_id(meta.labels, label_name),
         {:ok, _} <- add_labels(issue_node_id, [label_id]) do
      :ok
    end
  end

  defp normalize_agent_kind(agent) when is_binary(agent) do
    case agent |> String.trim() |> String.downcase() do
      normalized when normalized in @agent_kinds -> normalized
      _ -> nil
    end
  end

  defp normalize_agent_kind(_agent), do: nil

  defp find_label_id(labels, label_name) when is_list(labels) do
    target = String.downcase(label_name)

    labels
    |> Enum.find(fn label -> String.downcase(label.name || "") == target end)
    |> case do
      %{id: id} when is_binary(id) -> {:ok, id}
      _ -> {:error, {:agent_label_missing, label_name}}
    end
  end

  defp add_labels(labelable_id, label_ids) do
    variables = %{"labelableId" => labelable_id, "labelIds" => label_ids}

    case client().graphql(Query.add_labels_mutation(), variables, []) do
      {:ok, response} -> {:ok, response}
      {:error, _} = error -> error
    end
  end

  defp priority_label_ids(by_name, priority) do
    case normalize_priority(priority) do
      nil ->
        []

      value ->
        case Map.get(by_name, "priority:" <> Integer.to_string(value)) do
          id when is_binary(id) -> [id]
          _ -> []
        end
    end
  end

  defp normalize_priority(value) when is_integer(value) and value in 0..4, do: value

  defp normalize_priority(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed in 0..4 -> parsed
      _ -> nil
    end
  end

  defp normalize_priority(_value), do: nil

  defp resolve_status_target(_cfg, status) when status in [nil, ""], do: {:ok, nil}

  defp resolve_status_target(cfg, status) do
    case client().graphql(Query.status_options_query(), %{"projectId" => cfg.project_id}, []) do
      {:ok, response} ->
        case Query.resolve_field_and_option(response, cfg.status_field, status) do
          {:ok, field_id, option_id} -> {:ok, {field_id, option_id}}
          {:error, _} = error -> error
        end

      {:error, _} = error ->
        error
    end
  end

  defp create_remote_issue(repo_id, title, attrs, label_ids) do
    input =
      %{"repositoryId" => repo_id, "title" => title, "body" => body(attrs)}
      |> put_when_present("labelIds", label_ids)
      |> put_when_present("assigneeIds", string_list(Map.get(attrs, "assignee_ids")))

    case client().graphql(Query.create_issue_mutation(), %{"input" => input}, []) do
      {:ok, response} -> Query.created_issue(response)
      {:error, _} = error -> error
    end
  end

  defp add_to_project(project_id, content_id) do
    variables = %{"projectId" => project_id, "contentId" => content_id}

    case client().graphql(Query.add_project_item_mutation(), variables, []) do
      {:ok, response} -> Query.project_item_id(response)
      {:error, _} = error -> error
    end
  end

  defp resolve_move_item_id(%Project{} = project, project_id, identifier, attrs) do
    case Map.get(attrs, "item_id") || Map.get(attrs, :item_id) do
      id when is_binary(id) and id != "" ->
        {:ok, id}

      _ ->
        cond do
          project_item_id?(identifier) ->
            {:ok, identifier}

          true ->
            resolve_move_item_id_from_issue_number(project, project_id, identifier)
        end
    end
  end

  defp project_item_id?(id) when is_binary(id), do: String.starts_with?(id, "PVTI_")
  defp project_item_id?(_), do: false

  defp resolve_move_item_id_from_issue_number(%Project{} = project, project_id, identifier) do
    %{repo: repo} = config(project)

    with {:ok, {owner, name}} <- RepoSpec.split(repo),
         {:ok, number} <- parse_issue_number(identifier),
         {:ok, issue_node_id} <- fetch_issue_node_id(owner, name, number),
         {:ok, item_id} <- fetch_project_item_id(issue_node_id, project_id) do
      {:ok, item_id}
    end
  end

  defp fetch_issue_node_id(owner, name, number) do
    case fetch_issue_details(owner, name, number) do
      {:ok, %{"id" => id}} when is_binary(id) -> {:ok, id}
      error -> error
    end
  end

  defp fetch_issue_details(owner, name, number) do
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case client().graphql(Query.issue_node_id_query(), variables, []) do
      {:ok, response} -> Query.issue_details(response)
      {:error, reason} -> {:error, reason}
    end
  end

  defp maybe_update_issue_content(%Project{} = project, %{"id" => issue_id}, attrs) do
    fields =
      %{}
      |> maybe_put_issue_field("title", title_attr(attrs))
      |> maybe_put_issue_field("body", description_attr(attrs))
      |> maybe_put_assignee_ids(project, attrs)

    if fields == %{} do
      {:ok, nil}
    else
      input = Map.put(fields, "id", issue_id)

      case client().graphql(Query.update_issue_mutation(), %{"input" => input}, []) do
        {:ok, response} -> Query.updated_issue(response)
        {:error, _} = error -> error
      end
    end
  end

  defp maybe_put_issue_field(map, _key, nil), do: map
  defp maybe_put_issue_field(map, key, value), do: Map.put(map, key, value)

  defp maybe_put_assignee_ids(map, project, attrs) do
    case assignee_ids_attr(attrs) do
      :skip -> map
      ids -> Map.put(map, "assigneeIds", resolve_github_assignee_ids(project, ids))
    end
  end

  defp resolve_github_assignee_ids(_project, []), do: []

  defp resolve_github_assignee_ids(%Project{} = project, requested) do
    with {:ok, users} <- list_assignable_users(project) do
      by_id = Map.new(users, fn user -> {user.id, user.id} end)
      by_login = Map.new(users, fn user -> {String.downcase(user.login || ""), user.id} end)

      requested
      |> Enum.map(fn value ->
        cond do
          is_binary(value) and Map.has_key?(by_id, value) -> value
          is_binary(value) -> Map.get(by_login, String.downcase(String.trim(value)))
          true -> nil
        end
      end)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()
    else
      _ -> requested
    end
  end

  defp maybe_sync_issue_labels(issue, repo_labels, attrs) do
    label_change? = Map.has_key?(attrs, "label_ids") or Map.has_key?(attrs, "labels")
    priority_change? = Map.has_key?(attrs, "priority") or Map.has_key?(attrs, :priority)

    if not label_change? and not priority_change? do
      :ok
    else
      issue_id = Map.fetch!(issue, "id")
      current = current_label_nodes(issue)
      system_ids = system_label_ids(current)
      by_name = Map.new(repo_labels, fn label -> {String.downcase(label.name || ""), label.id} end)

      user_ids =
        case label_ids_attr(attrs) do
          nil ->
            current
            |> Enum.reject(fn node ->
              name = Map.get(node, "name")
              system_label_name?(name) or priority_label_name?(name)
            end)
            |> Enum.map(& &1["id"])
            |> Enum.reject(&is_nil/1)

          requested ->
            resolve_requested_label_ids(repo_labels, requested)
        end

      priority_ids =
        if priority_change? do
          priority_label_ids(by_name, Map.get(attrs, "priority") || Map.get(attrs, :priority))
        else
          current
          |> Enum.filter(fn node -> priority_label_name?(Map.get(node, "name")) end)
          |> Enum.map(& &1["id"])
          |> Enum.reject(&is_nil/1)
        end

      label_ids = Enum.uniq(system_ids ++ user_ids ++ priority_ids)

      case client().graphql(Query.update_issue_mutation(), %{"input" => %{"id" => issue_id, "labelIds" => label_ids}}, []) do
        {:ok, _} -> :ok
        {:error, _} = error -> error
      end
    end
  end

  defp current_label_nodes(%{"labels" => %{"nodes" => nodes}}) when is_list(nodes), do: nodes
  defp current_label_nodes(_issue), do: []

  defp system_label_ids(nodes) do
    nodes
    |> Enum.filter(fn node -> system_label_name?(Map.get(node, "name")) end)
    |> Enum.map(& &1["id"])
    |> Enum.reject(&is_nil/1)
  end

  defp system_label_name?(name) when is_binary(name) do
    String.match?(String.downcase(String.trim(name)), ~r/^symphony(?::.*)?$/)
  end

  defp system_label_name?(_name), do: false

  defp priority_label_name?(name) when is_binary(name) do
    String.match?(String.downcase(String.trim(name)), ~r/^priority:\d$/)
  end

  defp priority_label_name?(_name), do: false

  defp resolve_requested_label_ids(labels, requested) do
    by_name = Map.new(labels, fn label -> {String.downcase(label.name || ""), label.id} end)
    by_id = Map.new(labels, fn label -> {label.id, label.id} end)

    requested
    |> Enum.map(fn value ->
      cond do
        is_binary(value) and Map.has_key?(by_id, value) -> value
        is_binary(value) -> Map.get(by_name, String.downcase(String.trim(value)))
        true -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp title_attr(attrs) do
    case attrs |> Map.get("title") |> trim_string() do
      "" -> nil
      value -> value
    end
  end

  defp description_attr(attrs) do
    if Map.has_key?(attrs, "description") or Map.has_key?(attrs, :description) do
      case attrs |> Map.get("description") |> trim_string() do
        "" -> ""
        value -> value
      end
    else
      nil
    end
  end

  defp label_ids_attr(attrs) do
    cond do
      Map.has_key?(attrs, "label_ids") ->
        values = string_list(Map.get(attrs, "label_ids")) |> Enum.uniq()
        if values == [], do: [], else: values

      Map.has_key?(attrs, "labels") ->
        values = string_list(Map.get(attrs, "labels")) |> Enum.uniq()
        if values == [], do: [], else: values

      true ->
        nil
    end
  end

  defp assignee_ids_attr(attrs) do
    cond do
      Map.has_key?(attrs, "assignee_ids") ->
        string_list(Map.get(attrs, "assignee_ids"))

      Map.has_key?(attrs, :assignee_ids) ->
        string_list(Map.get(attrs, :assignee_ids))

      Map.has_key?(attrs, "assignee_id") ->
        case Map.get(attrs, "assignee_id") do
          value when is_binary(value) and value != "" -> [value]
          _ -> []
        end

      true ->
        :skip
    end
  end

  defp fetch_project_item_id(issue_node_id, project_id) do
    variables = %{"issueId" => issue_node_id, "first" => 50}

    case client().graphql(Query.resolve_project_item_query(), variables, []) do
      {:ok, %{"data" => %{"node" => %{"projectItems" => %{"nodes" => nodes}}}}} when is_list(nodes) ->
        case find_project_item_id(nodes, project_id) do
          id when is_binary(id) -> {:ok, id}
          _ -> {:error, :issue_not_found}
        end

      {:ok, %{"data" => %{"node" => nil}}} ->
        {:error, :issue_not_found}

      {:ok, _payload} ->
        {:error, :issue_not_found}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp find_project_item_id(nodes, project_id) do
    nodes
    |> List.wrap()
    |> Enum.find_value(fn
      %{"id" => id, "project" => %{"id" => ^project_id}} -> id
      _ -> nil
    end)
  end

  defp parse_issue_number(identifier) when is_binary(identifier) do
    trimmed = String.trim(identifier)

    case trimmed do
      "#" <> rest -> parse_issue_digits(rest)
      digits -> parse_issue_digits(digits)
    end
  end

  defp parse_issue_number(_identifier), do: {:error, :invalid_issue_identifier}

  defp parse_issue_digits(digits) do
    case Integer.parse(String.trim(digits)) do
      {number, ""} when number > 0 -> {:ok, number}
      _ -> {:error, :invalid_issue_identifier}
    end
  end

  defp apply_status_target(_cfg, _item_id, nil), do: :ok

  defp apply_status_target(cfg, item_id, {field_id, option_id}) do
    variables = %{
      "projectId" => cfg.project_id,
      "itemId" => item_id,
      "fieldId" => field_id,
      "optionId" => option_id
    }

    case client().graphql(Query.update_field_value_mutation(), variables, []) do
      {:ok, _response} -> :ok
      {:error, _} = error -> error
    end
  end

  defp build_created_dto(issue, %Project{} = project, attrs, labels, label_ids) do
    IssueDTO.build(%{
      id: issue["id"],
      identifier: to_string(issue["number"]),
      title: issue["title"] || Map.get(attrs, "title"),
      description: body(attrs),
      url: issue["url"],
      labels: label_names(labels, label_ids),
      status: status_dto(status_name(attrs)),
      project_slug: project.slug
    })
  end

  defp label_names(labels, label_ids) do
    by_id = Map.new(labels, fn label -> {label.id, label.name} end)

    label_ids
    |> Enum.map(&Map.get(by_id, &1))
    |> Enum.reject(&is_nil/1)
  end

  defp status_dto(status) when status in [nil, ""], do: nil

  defp status_dto(status) do
    category = Query.category_for(status)
    %{name: status, category: category, position: nil, is_terminal: category in ["completed", "canceled"]}
  end

  defp status_name(attrs), do: attrs |> Map.get("status") |> trim_string()

  defp body(attrs) do
    case attrs |> Map.get("description") |> trim_string() do
      "" -> nil
      value -> value
    end
  end

  defp put_when_present(map, _key, []), do: map
  defp put_when_present(map, key, value), do: Map.put(map, key, value)

  defp string_list(value) when is_list(value), do: Enum.filter(value, &(is_binary(&1) and &1 != ""))
  defp string_list(_value), do: []

  defp trim_string(value) when is_binary(value), do: String.trim(value)
  defp trim_string(_value), do: ""

  defp client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error({:remote_validation, _details} = error), do: error
  defp map_error(:issue_not_found), do: :issue_not_found
  defp map_error(:status_not_found), do: :status_not_found
  defp map_error(:missing_github_token), do: :missing_credentials

  defp map_error({:agent_label_missing, label_name}),
    do:
      {:remote_validation,
       %{
         agent_label: [
           "repository is missing the \"#{label_name}\" label required to route this issue to the agent"
         ]
       }}

  defp map_error({:github_graphql_errors, errors}),
    do: {:remote_validation, %{errors: summarize_graphql_errors(errors)}}

  defp map_error({:github_api_status, 401}), do: :remote_unauthorized
  defp map_error({:github_api_status, 403}), do: :remote_forbidden
  defp map_error({:github_api_status, status}) when status in 500..599, do: :remote_unavailable
  defp map_error({:rate_limited, info}) when is_map(info), do: {:rate_limited, info}
  defp map_error(_), do: :remote_unavailable

  defp summarize_graphql_errors(errors) when is_list(errors) do
    Enum.flat_map(errors, fn
      %{"message" => message} when is_binary(message) -> [message]
      _ -> []
    end)
  end

  defp summarize_graphql_errors(_errors), do: []
end
