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

  test "POST /github/projects/discover returns boards" do
    conn = post(authorized_conn(), "/api/tracker/v1/github/projects/discover", %{})
    assert %{"data" => [%{"id" => "PVT_1", "number" => 7, "title" => "Roadmap"}]} = json_response(conn, 200)
  end
end
