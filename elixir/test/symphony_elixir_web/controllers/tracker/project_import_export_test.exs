defmodule SymphonyElixirWeb.Tracker.ProjectImportExportTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.{Context, Projects}
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

  test "GET /projects/:id/export returns YAML bundle" do
    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Gamba",
        "slug" => "gamba",
        "description" => "Test",
        "tracker" => %{"kind" => "local", "config" => %{}},
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [
          %{
            "github_full_name" => "g/api",
            "clone_url" => "https://github.com/g/api.git",
            "workspace_path" => "api",
            "role" => "backend"
          }
        ],
        "setup" => %{
          "workflow_markdown" => "---\ntracker:\n  active_states: [Todo]\n---\n\nHello",
          "validation_commands" => ["mix test"]
        }
      })

    conn = get(authorized_conn(), "/api/tracker/v1/projects/gamba/export")
    assert conn.status == 200
    assert get_resp_header(conn, "content-type") == ["text/yaml; charset=utf-8"]
    assert conn.resp_body =~ "symphony_project"
    assert conn.resp_body =~ "slug: \"gamba\""
    assert conn.resp_body =~ "Hello"
  end

  test "POST /projects/import creates a project from YAML" do
    source_slug = create_sample_project()
    {:ok, yaml} = Projects.export_yaml(source_slug)
    Repo.query!("delete from local_tracker_clone_jobs")
    Repo.query!("delete from local_tracker_repositories")
    Repo.query!("delete from local_tracker_project_setups")
    Repo.query!("delete from local_tracker_workflow_statuses")
    Repo.query!("delete from local_tracker_projects")

    conn = post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})
    assert %{"data" => %{"slug" => "sample-export"}} = json_response(conn, 201)
  end

  test "POST /projects/import rejects duplicate slug" do
    slug = create_sample_project()
    {:ok, yaml} = Projects.export_yaml(slug)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})
    assert json_response(conn, 422)["error"]["message"] =~ "slug already exists"
  end

  test "POST /projects/:id/import applies bundle to existing project" do
    source_slug = create_sample_project()
    {:ok, _dest} = Context.ensure_project(%{name: "Dest", slug: "dest", tracker_kind: "local"})
    {:ok, yaml} = Projects.export_yaml(source_slug)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/dest/import", %{"yaml" => yaml})
    assert %{"data" => %{"slug" => "dest", "setup" => %{"workflow_markdown" => markdown}}} = json_response(conn, 200)
    assert markdown =~ "Hello"
  end

  defp create_sample_project do
    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Sample Export",
        "slug" => "sample-export",
        "tracker" => %{"kind" => "local", "config" => %{}},
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [
          %{
            "github_full_name" => "g/api",
            "clone_url" => "https://github.com/g/api.git",
            "workspace_path" => "api",
            "role" => "backend"
          }
        ],
        "setup" => %{
          "workflow_markdown" => "---\ntracker:\n  active_states: [Todo]\n---\n\nHello",
          "validation_commands" => ["mix test"]
        }
      })

    project.slug
  end

  defp clean_repo do
    Repo.query!("delete from local_tracker_clone_jobs")
    Repo.query!("delete from local_tracker_repositories")
    Repo.query!("delete from local_tracker_project_setups")
    Repo.query!("delete from local_tracker_workflow_statuses")
    Repo.query!("delete from local_tracker_projects")
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
    |> put_req_header("content-type", "application/json")
  end
end
