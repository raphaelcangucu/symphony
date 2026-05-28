defmodule SymphonyElixirWeb.Tracker.RemoteDiscoveryController do
  @moduledoc "Discovers GitHub Project v2 boards and Linear projects for the wizard."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.Client, as: GitHubClient
  alias SymphonyElixir.Linear.Client, as: LinearClient
  alias SymphonyElixirWeb.TrackerErrors

  @github_projects """
  query SymphonyDiscoverProjects {
    viewer {
      projectsV2(first: 50) {
        nodes { id number title owner { __typename ... on User { login } ... on Organization { login } } }
      }
    }
  }
  """

  @linear_projects """
  query SymphonyDiscoverLinearProjects {
    viewer {
      teamMemberships(first: 50) {
        nodes { team { id name projects(first: 50) { nodes { id slugId name state } } } }
      }
    }
  }
  """

  @spec github_discover(Conn.t(), map()) :: Conn.t()
  def github_discover(conn, _params) do
    case github_client().graphql(@github_projects, %{}, []) do
      {:ok, response} ->
        nodes = get_in(response, ["data", "viewer", "projectsV2", "nodes"]) || []
        json(conn, %{data: Enum.map(nodes, &github_project_dto/1)})

      {:error, reason} ->
        TrackerErrors.render(conn, github_error(reason))
    end
  end

  @spec linear_discover(Conn.t(), map()) :: Conn.t()
  def linear_discover(conn, _params) do
    case linear_client().graphql(@linear_projects, %{}, []) do
      {:ok, response} ->
        json(conn, %{data: linear_projects_dto(response)})

      {:error, reason} ->
        TrackerErrors.render(conn, linear_error(reason))
    end
  end

  defp github_project_dto(node) do
    %{
      id: node["id"],
      number: node["number"],
      title: node["title"],
      owner: %{login: get_in(node, ["owner", "login"]), kind: owner_kind(get_in(node, ["owner", "__typename"]))}
    }
  end

  defp owner_kind("Organization"), do: "organization"
  defp owner_kind(_), do: "user"

  defp linear_projects_dto(%{"data" => %{"viewer" => %{"teamMemberships" => %{"nodes" => memberships}}}}) do
    Enum.flat_map(memberships, fn %{"team" => team} ->
      team
      |> get_in(["projects", "nodes"])
      |> List.wrap()
      |> Enum.map(fn project ->
        %{
          id: project["id"],
          slugId: project["slugId"],
          name: project["name"],
          state: project["state"],
          team: %{id: team["id"], name: team["name"]}
        }
      end)
    end)
  end

  defp linear_projects_dto(_), do: []

  defp github_client, do: Application.get_env(:symphony_elixir, :github_client_module, GitHubClient)
  defp linear_client, do: Application.get_env(:symphony_elixir, :linear_client_module, LinearClient)

  defp github_error(:missing_github_token), do: :missing_credentials
  defp github_error({:github_api_status, 401}), do: :remote_unauthorized
  defp github_error(_), do: :remote_unavailable

  defp linear_error({:linear_api_status, 401}), do: :remote_unauthorized
  defp linear_error(_), do: :remote_unavailable
end
