defmodule SymphonyElixirWeb.Tracker.RemoteDiscoveryControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  defmodule GitHubProjectsStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "viewer" => %{
             "projectsV2" => %{
               "nodes" => [
                 %{"id" => "PVT_1", "number" => 7, "title" => "Roadmap", "owner" => %{"login" => "o", "__typename" => "User"}}
               ]
             },
             "organizations" => %{
               "nodes" => [
                 %{
                   "projectsV2" => %{
                     "nodes" => [
                       %{
                         "id" => "PVT_2",
                         "number" => 2,
                         "title" => "Macro Markets",
                         "owner" => %{"login" => "clouapp", "__typename" => "Organization"}
                       },
                       # Duplicate of the viewer-owned board: must be de-duplicated by id.
                       %{"id" => "PVT_1", "number" => 7, "title" => "Roadmap", "owner" => %{"login" => "o", "__typename" => "User"}}
                     ]
                   }
                 }
               ]
             }
           }
         }
       }}
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    Application.put_env(:symphony_elixir, :github_client_module, GitHubProjectsStub)

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :github_client_module)
      if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env)
    end)

    :ok
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  test "POST /github/projects/discover returns viewer and organization boards, de-duplicated" do
    conn = post(authorized_conn(), "/api/tracker/v1/github/projects/discover", %{})
    assert %{"data" => boards} = json_response(conn, 200)

    ids = Enum.map(boards, & &1["id"])
    assert ids == ["PVT_1", "PVT_2"]

    org_board = Enum.find(boards, &(&1["id"] == "PVT_2"))
    assert org_board["title"] == "Macro Markets"
    assert org_board["owner"]["login"] == "clouapp"
    assert org_board["owner"]["kind"] == "organization"
  end
end
