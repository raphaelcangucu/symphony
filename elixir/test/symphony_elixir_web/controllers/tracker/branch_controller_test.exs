defmodule SymphonyElixirWeb.Tracker.BranchControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest

  alias SymphonyElixir.GitHub.ReadCache
  alias SymphonyElixir.LocalTracker.Context

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @github_token_env "GITHUB_TOKEN"

  defmodule FakeClient do
    @moduledoc false

    def rest_get("/repos/o/r/branches?" <> _qs, _opts) do
      {:ok,
       %{
         status: 200,
         body: [
           %{"name" => "main", "protected" => true, "commit" => %{"sha" => "aaa"}},
           %{"name" => "codex/adv-2", "protected" => false, "commit" => %{"sha" => "bbb"}}
         ]
       }}
    end

    def rest_get("/repos/o/r/git/matching-refs/heads/feature/graphql", _opts) do
      {:ok,
       %{
         status: 200,
         body: [
           %{
             "ref" => "refs/heads/feature/graphql-go-api-CDE-1075",
             "object" => %{"sha" => "ggg"}
           }
         ]
       }}
    end

    def rest_get("/repos/o/r/git/matching-refs/heads/" <> _rest, _opts) do
      {:ok, %{status: 200, body: []}}
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    clean_repo()
    ReadCache.invalidate_all()
    Application.put_env(:symphony_elixir, :github_client_module, FakeClient)

    prev_token = System.get_env(@token_env)
    prev_gh = System.get_env(@github_token_env)
    System.put_env(@token_env, "secret")
    System.put_env(@github_token_env, "gh-token")

    on_exit(fn ->
      restore_env(@token_env, prev_token)
      restore_env(@github_token_env, prev_gh)
      Application.delete_env(:symphony_elixir, :github_client_module)
    end)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Advising",
        "slug" => "advising-branches",
        "tracker" => %{"kind" => "jira", "config" => %{"project_key" => "ADV"}},
        "repositories" => [
          %{
            "github_full_name" => "o/r",
            "clone_url" => "https://github.com/o/r.git",
            "role" => "primary",
            "workspace_path" => "r"
          }
        ],
        "setup" => %{}
      })

    :ok
  end

  test "lists repo branches for the project" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/advising-branches/branches")

    assert %{"data" => data, "supported" => true} = json_response(conn, 200)
    names = Enum.map(data, & &1["name"])
    assert "codex/adv-2" in names
    assert "main" in names
  end

  test "searches branches with q via matching-refs" do
    conn =
      get(authorized_conn(), "/api/tracker/v1/projects/advising-branches/branches", %{
        "q" => "feature/graphql"
      })

    assert %{"data" => data, "supported" => true} = json_response(conn, 200)
    assert [%{"name" => "feature/graphql-go-api-CDE-1075", "repo" => "o/r"}] = data
  end

  defp authorized_conn do
    build_conn() |> Plug.Conn.put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo, do: Ecto.Migrator.run(SymphonyElixir.Repo, :up, all: true)
  defp clean_repo, do: SymphonyElixir.Repo.delete_all(SymphonyElixir.LocalTracker.Project)
  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
