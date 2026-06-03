defmodule SymphonyElixirWeb.Tracker.RemoteDiscoveryController do
  @moduledoc "Discovers GitHub Project v2 boards and Linear projects for the wizard."

  use Phoenix.Controller, formats: [:json]

  alias Plug.Conn
  alias SymphonyElixir.GitHub.Discovery
  alias SymphonyElixir.Linear.Client, as: LinearClient
  alias SymphonyElixirWeb.TrackerErrors

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
    case Discovery.list_projects() do
      {:ok, projects} ->
        json(conn, %{data: projects})

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

  defp linear_client, do: Application.get_env(:symphony_elixir, :linear_client_module, LinearClient)

  defp github_error(:missing_github_token), do: :missing_credentials
  defp github_error({:rate_limited, _info} = reason), do: reason
  defp github_error({:github_api_status, 401}), do: :remote_unauthorized
  defp github_error({:github_api_status, 403}), do: :remote_forbidden
  defp github_error(_), do: :remote_unavailable

  defp linear_error({:rate_limited, _info} = reason), do: reason
  defp linear_error({:linear_api_status, 401}), do: :remote_unauthorized
  defp linear_error(_), do: :remote_unavailable
end
