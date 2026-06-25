defmodule SymphonyElixirWeb.Tracker.ProjectImportExportTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.{Context, DevEnv, Projects}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport

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
    assert conn.resp_body =~ "workflow_markdown"
    assert conn.resp_body =~ "Hello"
  end

  test "POST /projects/import creates a project from YAML" do
    source_slug = create_sample_project()
    {:ok, yaml} = Projects.export_yaml(source_slug)
    clean_repo()

    conn = post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})

    assert %{"data" => %{"slug" => "sample-export", "setup" => %{"workflow_markdown" => markdown}}} =
             json_response(conn, 201)

    assert markdown =~ "Hello"
  end

  test "POST /projects/import accepts an HTTPS url" do
    source_slug = create_sample_project()
    {:ok, yaml} = Projects.export_yaml(source_slug)
    clean_repo()

    Application.put_env(:symphony_elixir, :project_yaml_http_get, fn _url -> {:ok, yaml} end)

    conn =
      post(authorized_conn(), "/api/tracker/v1/projects/import", %{
        "url" => "https://example.com/sample-export.yaml"
      })

    assert %{"data" => %{"slug" => "sample-export"}} = json_response(conn, 201)
  end

  test "POST /projects/import overwrites an existing project configuration" do
    slug = create_sample_project()
    {:ok, yaml} = Projects.export_yaml(slug)

    conn = post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => updated_yaml(yaml)})

    assert %{"data" => %{"slug" => "sample-export", "setup" => %{"workflow_markdown" => markdown}}} =
             json_response(conn, 201)

    assert markdown =~ "Updated prompt"
  end

  test "POST /projects/import persists workflow for github tracker projects" do
    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "Remote",
        "slug" => "remote-export",
        "tracker" => %{"kind" => "github", "config" => %{"repo" => "org/repo", "project_id" => "1"}},
        "repositories" => [
          %{
            "github_full_name" => "org/repo",
            "clone_url" => "https://github.com/org/repo.git",
            "workspace_path" => "repo",
            "role" => "app"
          }
        ],
        "workflow_statuses" => []
      })

    {:ok, _setup} =
      Context.upsert_project_setup(project.slug, %{
        "workflow_markdown" => "---\ntracker:\n  active_states: [Todo]\n---\n\nRemote prompt",
        "validation_commands" => ["mix test"]
      })

    Context.import_workflow_statuses(project.slug, [
      %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
    ])

    {:ok, yaml} = Projects.export_yaml(project.slug)
    clean_repo()

    conn = post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})

    assert %{"data" => %{"slug" => "remote-export", "setup" => %{"workflow_markdown" => markdown}}} =
             json_response(conn, 201)

    assert markdown =~ "Remote prompt"
  end

  test "export/import round-trips dev env steps" do
    slug = create_sample_project()

    {:ok, _steps} =
      DevEnv.save_steps(slug, [
        %{
          "description" => "Install deps",
          "command" => "pnpm install",
          "working_dir" => "api",
          "role" => "setup"
        }
      ])

    {:ok, yaml} = Projects.export_yaml(slug)
    clean_repo()

    post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})

    [step] = DevEnv.list_steps("sample-export")
    assert step.description == "Install deps"
    assert step.command == "pnpm install"
  end

  test "export/import round-trips preview serve steps" do
    slug = create_sample_project()

    {:ok, _steps} =
      DevEnv.save_steps(slug, [
        %{
          "description" => "Install frontend deps",
          "command" => "yarn install",
          "working_dir" => "frontend",
          "role" => "setup"
        },
        %{
          "description" => "Frontend dev server",
          "command" => "npm run dev -- --host 0.0.0.0",
          "working_dir" => "frontend",
          "role" => "serve",
          "port_env" => "PORT",
          "url_path" => "/",
          "ready_probe" => "http",
          "ready_path" => "/",
          "primary" => true
        }
      ])

    {:ok, yaml} = Projects.export_yaml(slug)
    assert yaml =~ "role: \"serve\""
    assert yaml =~ "ready_probe: \"http\""
    clean_repo()

    post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})

    [setup, serve] = DevEnv.list_steps("sample-export")
    assert setup.role == "setup"
    assert serve.role == "serve"
    assert serve.primary
    assert serve.ready_probe == "http"
    assert serve.port_env == "PORT"
  end

  test "import accepts ready alias for serve steps" do
    slug = create_sample_project()

    yaml = """
    kind: symphony_project
    version: 2
    slug: sample-export
    name: Sample Export
    tracker:
      kind: local
      config: {}
    dev_env_steps:
      - description: Frontend dev server
        command: npm run dev
        working_dir: frontend
        role: serve
        port_env: PORT
        ready: http
        ready_path: /
        primary: true
    """

    post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})

    [serve] = DevEnv.list_serve_steps(slug)
    assert serve.ready_probe == "http"
    assert serve.primary
  end

  test "import strips legacy process-owned workflow sections from bundles" do
    slug = create_sample_project()

    yaml = """
    kind: symphony_project
    version: 2
    slug: sample-export
    name: Sample Export
    tracker:
      kind: local
      config: {}
    setup:
      workflow_markdown: |
        ---
        github:
          repo: org/repo
        polling:
          interval_ms: 5000
        editor:
          enabled: true
        tracker:
          active_states: [Todo]
        ---

        Legacy prompt
    """

    post(authorized_conn(), "/api/tracker/v1/projects/import", %{"yaml" => yaml})

    setup = Context.get_project_setup(slug)
    assert setup.workflow_markdown =~ "Legacy prompt"
    refute setup.workflow_markdown =~ "github:"
    refute setup.workflow_markdown =~ "polling:"
    refute setup.workflow_markdown =~ "editor:"
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

  defp updated_yaml(yaml) do
    yaml
    |> String.replace("Hello", "Updated prompt")
    |> String.replace("Sample Export", "Sample Export Updated")
  end

  defp clean_repo do
    TestSupport.truncate_tracker!(Repo)
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
    |> put_req_header("content-type", "application/json")
  end
end
