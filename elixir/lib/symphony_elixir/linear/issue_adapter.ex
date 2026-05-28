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

    case client().graphql(Query.team_states_query(), %{"projectId" => project_id}, []) do
      {:ok, response} -> {:ok, Query.team_states(response)}
      error -> {:error, map_error(error)}
    end
  end

  @impl true
  def create_issue(%Project{} = _project, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def update_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def move_issue(%Project{} = _project, _identifier, _attrs), do: {:error, :not_supported_on_remote}

  @impl true
  def list_comments(%Project{} = _project, _identifier), do: {:error, :not_supported_on_remote}

  @impl true
  def add_comment(%Project{} = _project, _identifier, _body, _attrs), do: {:error, :not_supported_on_remote}

  defp client, do: Application.get_env(:symphony_elixir, :linear_client_module, Client)

  defp map_error({:error, reason}), do: map_error(reason)
  defp map_error({:linear_api_status, 401}), do: :remote_unauthorized
  defp map_error({:linear_api_status, 403}), do: :remote_forbidden
  defp map_error({:linear_api_status, status}) when status in 500..599, do: :remote_unavailable
  defp map_error(_), do: :remote_unavailable
end
