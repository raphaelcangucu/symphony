defmodule SymphonyElixir.GitHub.Discovery do
  @moduledoc false

  alias SymphonyElixir.GitHub.Client

  @github_projects """
  query SymphonyDiscoverProjects {
    viewer {
      projectsV2(first: 50) {
        nodes { id number title owner { __typename ... on User { login } ... on Organization { login } } }
      }
      organizations(first: 25) {
        nodes {
          projectsV2(first: 50) {
            nodes { id number title owner { __typename ... on User { login } ... on Organization { login } } }
          }
        }
      }
    }
  }
  """

  @spec list_projects(keyword()) :: {:ok, [map()]} | {:error, term()}
  def list_projects(opts \\ []) do
    client = Keyword.get(opts, :client_module, client_module())

    case client.graphql(@github_projects, %{}, []) do
      {:ok, response} -> {:ok, projects_from_response(response)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp projects_from_response(response) do
    viewer = get_in(response, ["data", "viewer"]) || %{}
    viewer_nodes = get_in(viewer, ["projectsV2", "nodes"]) || []

    org_nodes =
      viewer
      |> get_in(["organizations", "nodes"])
      |> List.wrap()
      |> Enum.flat_map(fn org -> get_in(org, ["projectsV2", "nodes"]) || [] end)

    (viewer_nodes ++ org_nodes)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq_by(& &1["id"])
    |> Enum.map(&project_dto/1)
  end

  defp project_dto(node) do
    %{
      id: node["id"],
      number: node["number"],
      title: node["title"],
      owner: %{
        login: get_in(node, ["owner", "login"]),
        kind: owner_kind(get_in(node, ["owner", "__typename"]))
      }
    }
  end

  defp owner_kind("Organization"), do: "organization"
  defp owner_kind(_), do: "user"

  defp client_module do
    Application.get_env(:symphony_elixir, :github_client_module, Client)
  end
end
