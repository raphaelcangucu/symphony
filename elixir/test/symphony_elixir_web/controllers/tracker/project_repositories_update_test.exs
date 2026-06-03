defmodule SymphonyElixirWeb.Tracker.ProjectRepositoriesUpdateTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
    clean_repo()

    previous = System.get_env(@token_env)
    System.put_env(@token_env, "secret")
    on_exit(fn -> if previous, do: System.put_env(@token_env, previous), else: System.delete_env(@token_env) end)
    :ok
  end

  test "PUT /projects/:id/repositories replaces the repository set and returns the project DTO" do
    {:ok, _project} = create_workspace_with_apollo()

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/acme/repositories", %{
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "acme/web", "role" => "frontend", "selected_branch" => "main"},
          %{"github_full_name" => "acme/api", "workspace_path" => "acme/api", "role" => "backend"}
        ]
      })

    assert %{"data" => %{"repositories" => repositories}} = json_response(conn, 200)

    paths = repositories |> Enum.map(& &1["workspace_path"]) |> Enum.sort()
    assert paths == ["acme/api", "acme/web"]

    full_names = repositories |> Enum.map(& &1["github_full_name"]) |> Enum.sort()
    assert full_names == ["acme/api", "acme/web"]

    persisted = Context.list_repositories("acme")
    assert length(persisted) == 2
    refute Enum.any?(persisted, &(&1.github_full_name == "acme/apollo"))
  end

  test "PUT /projects/:id/repositories accepts an empty list to unlink all repositories" do
    {:ok, _project} = create_workspace_with_apollo()

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/acme/repositories", %{"repositories" => []})

    assert %{"data" => %{"repositories" => []}} = json_response(conn, 200)
    assert Context.list_repositories("acme") == []
  end

  test "PUT /projects/:id/repositories rejects a repository missing github_full_name with 422 and persists nothing" do
    {:ok, _project} = create_workspace_with_apollo()

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/acme/repositories", %{
        "repositories" => [%{"workspace_path" => "acme/web", "role" => "frontend"}]
      })

    assert json_response(conn, 422)["error"]["code"] == "validation_failed"

    persisted = Context.list_repositories("acme")
    assert length(persisted) == 1
    assert hd(persisted).github_full_name == "acme/apollo"
  end

  test "PUT /projects/:id/repositories rejects a non-list body with 422" do
    {:ok, _project} = create_workspace_with_apollo()

    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/acme/repositories", %{"repositories" => "nope"})

    assert json_response(conn, 422)["error"]["code"] == "validation_failed"
  end

  test "PUT /projects/:id/repositories returns 404 for an unknown project" do
    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/nope/repositories", %{
        "repositories" => [%{"github_full_name" => "acme/web", "workspace_path" => "acme/web", "role" => "frontend"}]
      })

    assert json_response(conn, 404)["error"]["code"] == "project_not_found"
  end

  defp create_workspace_with_apollo do
    Context.create_workspace_project(%{
      "name" => "Acme",
      "slug" => "acme",
      "tracker" => %{"kind" => "local"},
      "workflow_statuses" => [%{"name" => "Todo", "category" => "todo", "position" => 1, "is_terminal" => false}],
      "repositories" => [
        %{"github_full_name" => "acme/apollo", "workspace_path" => "acme/apollo", "role" => "service"}
      ],
      "setup" => %{}
    })
  end

  defp authorized_conn, do: build_conn() |> put_req_header("authorization", "Bearer secret")

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
