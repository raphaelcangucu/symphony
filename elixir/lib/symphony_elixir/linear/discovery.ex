defmodule SymphonyElixir.Linear.Discovery do
  @moduledoc false

  alias SymphonyElixir.Linear.Client, as: LinearClient

  @linear_projects """
  query SymphonyDiscoverLinearProjects {
    viewer {
      teamMemberships(first: 50) {
        nodes { team { id name projects(first: 50) { nodes { id slugId name state } } } }
      }
    }
  }
  """

  @spec list_projects(keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_projects(opts \\ []) do
    client = Keyword.get(opts, :client_module, client_module())

    case client.graphql(@linear_projects, %{}, []) do
      {:ok, response} -> {:ok, projects_from_response(response)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp projects_from_response(%{"data" => %{"viewer" => %{"teamMemberships" => %{"nodes" => memberships}}}}) do
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

  defp projects_from_response(_), do: []

  defp client_module do
    Application.get_env(:symphony_elixir, :linear_client_module, LinearClient)
  end
end
