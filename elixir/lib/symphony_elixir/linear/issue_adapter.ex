defmodule SymphonyElixir.Linear.IssueAdapter do
  @moduledoc "Linear project implementation of `Tracker.IssueAdapter` (UI reads/writes)."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.Linear.Client
  alias SymphonyElixir.Linear.IssueAdapter.Query
  alias SymphonyElixir.LocalTracker.Project

  @impl true
  def kind, do: :linear

  @impl true
  def list_issues(%Project{} = project, _filters) do
    project_id = Map.fetch!(project.tracker_config, "project_id")

    case client().graphql(Query.list_issues_query(), %{"projectId" => project_id}, []) do
      {:ok, response} ->
        issues =
          response
          |> get_in(["data", "project", "issues", "nodes"])
          |> List.wrap()
          |> Enum.map(&Query.normalize_issue(&1, project.slug))

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
    project_id = Map.fetch!(project.tracker_config, "project_id")

    case run_query(Query.team_states_query(), %{"projectId" => project_id}) do
      {:ok, response} -> {:ok, Query.team_states(response)}
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def list_labels(%Project{} = project) do
    project_id = Map.fetch!(project.tracker_config, "project_id")

    case run_query(Query.team_labels_query(), %{"projectId" => project_id}) do
      {:ok, response} -> {:ok, Query.team_labels(response)}
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def list_assignable_users(%Project{} = project) do
    project_id = Map.fetch!(project.tracker_config, "project_id")

    case run_query(Query.team_members_query(), %{"projectId" => project_id}) do
      {:ok, response} -> {:ok, Query.team_members(response)}
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def create_issue(%Project{} = project, attrs) when is_map(attrs) do
    project_id = Map.fetch!(project.tracker_config, "project_id")

    with {:ok, title} <- require_title(attrs),
         {:ok, states} <- run_query(Query.team_states_query(), %{"projectId" => project_id}),
         {:ok, team_id} <- Query.team_id(states),
         {:ok, state_id} <- Query.state_id(states, status_name(attrs)),
         {:ok, label_ids} <- resolve_label_ids(project_id, attrs),
         input = build_input(project_id, team_id, title, state_id, label_ids, attrs),
         {:ok, response} <- run_query(Query.create_issue_mutation(), %{"input" => input}),
         {:ok, dto} <- Query.created_issue(response, project.slug) do
      {:ok, dto}
    else
      {:error, reason} -> {:error, map_error(reason)}
    end
  end

  @impl true
  def update_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def move_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def list_comments(%Project{} = _project, _identifier), do: {:error, :not_supported_on_remote}

  @impl true
  def add_comment(%Project{} = _project, _identifier, _body, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def update_comment(%Project{} = _project, _identifier, _comment_id, _body), do: {:error, :not_supported_on_remote}

  @impl true
  def delete_comment(%Project{} = _project, _identifier, _comment_id), do: {:error, :not_supported_on_remote}

  defp run_query(query, variables) do
    case client().graphql(query, variables, []) do
      {:ok, %{"errors" => errors}} when is_list(errors) and errors != [] ->
        {:error, {:linear_graphql_errors, errors}}

      {:ok, response} ->
        {:ok, response}

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

  defp resolve_label_ids(project_id, attrs) do
    base = string_list(Map.get(attrs, "label_ids"))

    case Map.get(attrs, "agent") do
      agent when agent in ["codex", "claude", "cursor"] ->
        case run_query(Query.team_labels_query(), %{"projectId" => project_id}) do
          {:ok, response} ->
            ids = base ++ agent_label_ids(Query.team_labels(response), agent)
            {:ok, Enum.uniq(ids)}

          {:error, _} = error ->
            error
        end

      _ ->
        {:ok, Enum.uniq(base)}
    end
  end

  defp agent_label_ids(labels, agent) do
    by_name = Map.new(labels, fn label -> {String.downcase(label.name || ""), label.id} end)

    case Map.get(by_name, "symphony:" <> agent) do
      id when is_binary(id) -> [id]
      _ -> []
    end
  end

  defp build_input(project_id, team_id, title, state_id, label_ids, attrs) do
    %{"teamId" => team_id, "projectId" => project_id, "title" => title}
    |> put_present("description", body(attrs))
    |> put_present("stateId", state_id)
    |> put_present("assigneeId", first_assignee(attrs))
    |> put_present("priority", normalize_priority(Map.get(attrs, "priority")))
    |> put_list("labelIds", label_ids)
  end

  defp first_assignee(attrs) do
    attrs |> Map.get("assignee_ids") |> string_list() |> List.first()
  end

  defp normalize_priority(value) when is_integer(value) and value in 0..4, do: value

  defp normalize_priority(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed in 0..4 -> parsed
      _ -> nil
    end
  end

  defp normalize_priority(_value), do: nil

  defp status_name(attrs), do: attrs |> Map.get("status") |> trim_string()

  defp body(attrs) do
    case attrs |> Map.get("description") |> trim_string() do
      "" -> nil
      value -> value
    end
  end

  defp put_present(map, _key, nil), do: map
  defp put_present(map, _key, ""), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp put_list(map, _key, []), do: map
  defp put_list(map, key, value) when is_list(value), do: Map.put(map, key, value)

  defp string_list(value) when is_list(value), do: Enum.filter(value, &(is_binary(&1) and &1 != ""))
  defp string_list(_value), do: []

  defp trim_string(value) when is_binary(value), do: String.trim(value)
  defp trim_string(_value), do: ""

  defp client, do: Application.get_env(:symphony_elixir, :linear_client_module, Client)

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error({:remote_validation, _details} = error), do: error
  defp map_error(:status_not_found), do: :status_not_found
  defp map_error(:team_not_found), do: :remote_unavailable
  defp map_error(:create_failed), do: :remote_unavailable

  defp map_error({:linear_graphql_errors, errors}),
    do: {:remote_validation, %{errors: summarize_graphql_errors(errors)}}

  defp map_error({:linear_api_status, 401}), do: :remote_unauthorized
  defp map_error({:linear_api_status, 403}), do: :remote_forbidden
  defp map_error({:linear_api_status, status}) when status in 500..599, do: :remote_unavailable
  defp map_error(_), do: :remote_unavailable

  defp summarize_graphql_errors(errors) when is_list(errors) do
    Enum.flat_map(errors, fn
      %{"message" => message} when is_binary(message) -> [message]
      _ -> []
    end)
  end

  defp summarize_graphql_errors(_errors), do: []
end
