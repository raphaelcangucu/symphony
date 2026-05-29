defmodule SymphonyElixir.GitHub.IssueAdapter do
  @moduledoc "GitHub Project v2 implementation of `Tracker.IssueAdapter` (UI reads/writes)."

  @behaviour SymphonyElixir.Tracker.IssueAdapter

  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.GitHub.IssueAdapter.Query
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  @page_size 50

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
  def create_issue(%Project{} = _project, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def update_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def move_issue(%Project{} = project, identifier, attrs) do
    %{project_id: project_id, status_field: status_field} = config(project)
    item_id = Map.get(attrs, "item_id") || Map.get(attrs, :item_id) || identifier
    target_status = Map.get(attrs, "status") || Map.get(attrs, "state") || Map.get(attrs, :status)

    with {:ok, fields_response} <-
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
  def list_comments(%Project{} = _project, _identifier), do: {:error, :not_supported_on_remote}

  @impl true
  def add_comment(%Project{} = _project, _identifier, _body, _attrs), do: {:error, :not_supported_on_remote}

  defp config(%Project{tracker_config: cfg}) do
    %{
      project_id: Map.fetch!(cfg, "project_id"),
      repo: Map.get(cfg, "repo"),
      status_field: Map.get(cfg, "status_field", "Status")
    }
  end

  defp client, do: Application.get_env(:symphony_elixir, :github_client_module, Client)

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error(:missing_github_token), do: :missing_credentials
  defp map_error({:github_api_status, 401}), do: :remote_unauthorized
  defp map_error({:github_api_status, 403}), do: :remote_forbidden
  defp map_error({:github_api_status, status}) when status in 500..599, do: :remote_unavailable
  defp map_error(_), do: :remote_unavailable
end
