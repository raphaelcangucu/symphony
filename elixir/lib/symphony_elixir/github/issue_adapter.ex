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

    case client().graphql(
           Query.list_items_query(),
           %{
             "projectId" => project_id,
             "first" => @page_size,
             "after" => nil
           },
           []
         ) do
      {:ok, response} ->
        issues =
          response
          |> get_in(["data", "node", "items", "nodes"])
          |> List.wrap()
          |> Enum.map(&Query.normalize_item(&1, status_field, project.slug))
          |> Enum.reject(&is_nil/1)

        {:ok, issues}

      error ->
        {:error, map_error(error)}
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
  def update_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

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
           ) do
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
    variables = %{"owner" => owner, "name" => name, "number" => number}

    case client().graphql(Query.issue_node_id_query(), variables, []) do
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => id}}}}} when is_binary(id) ->
        {:ok, id}

      {:ok, _payload} ->
        {:error, :issue_not_found}

      {:error, reason} ->
        {:error, reason}
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
