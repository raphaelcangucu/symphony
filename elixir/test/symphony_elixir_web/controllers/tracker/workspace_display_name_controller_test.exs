defmodule SymphonyElixirWeb.Tracker.FailingWorkspaceDisplayNameInventory do
  @moduledoc false

  def scan(_project_slug), do: {:error, :inventory_failed}
end

defmodule SymphonyElixirWeb.Tracker.WorkspaceDisplayNameControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.GitFixtures
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @inventory_module_env :workspace_display_name_inventory_module
  @base_path "/api/tracker/v1/projects/demo/workspaces/display_names"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    previous_inventory_module = Application.get_env(:symphony_elixir, @inventory_module_env)
    System.put_env(@token_env, "secret")
    Application.delete_env(:symphony_elixir, @inventory_module_env)

    tmp = Path.join(System.tmp_dir!(), "workspace-display-name-#{System.unique_integer([:positive])}")
    root = Path.join(tmp, "workspaces")
    File.mkdir_p!(root)

    workflow_file = Path.join(tmp, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: root)
    Workflow.set_workflow_file_path(workflow_file)

    {:ok, _project} = Context.ensure_project(%{name: "Demo", slug: "demo"})
    {:ok, issue} = Context.create_issue("demo", %{"title" => "Alias workspace", "status" => "Todo"})

    workspace_path = Path.join([root, "demo", issue.identifier])
    _repo_path = GitFixtures.make_repo!(tmp, workspace_path, "app")
    project_root = Path.join(root, "demo")

    on_exit(fn ->
      restore_env(previous_token)
      restore_inventory_module(previous_inventory_module)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(tmp)
    end)

    {:ok, project_root: project_root, root: root, tmp: tmp, workspace_path: workspace_path}
  end

  test "GET returns an empty list", %{workspace_path: _workspace_path} do
    conn = get(authorized_conn(), @base_path)
    assert json_response(conn, 200) == %{"data" => []}
  end

  test "PUT normalizes a project workspace path and GET returns its alias", %{workspace_path: workspace_path} do
    ambiguous_path = Path.join(workspace_path, "nested/..")

    conn =
      put(authorized_conn(), @base_path, %{
        "path" => ambiguous_path,
        "display_name" => " Feature B "
      })

    assert %{
             "data" => %{
               "project_slug" => "demo",
               "workspace_path" => ^workspace_path,
               "display_name" => "Feature B"
             }
           } = json_response(conn, 200)

    conn = get(authorized_conn(), @base_path)

    assert json_response(conn, 200) == %{
             "data" => [
               %{
                 "project_slug" => "demo",
                 "workspace_path" => workspace_path,
                 "display_name" => "Feature B"
               }
             ]
           }
  end

  test "a second PUT updates the existing alias", %{workspace_path: workspace_path} do
    assert %{"data" => %{"display_name" => "First"}} =
             authorized_conn()
             |> put(@base_path, %{"path" => workspace_path, "display_name" => "First"})
             |> json_response(200)

    assert %{"data" => %{"display_name" => "Second"}} =
             authorized_conn()
             |> put(@base_path, %{"path" => workspace_path, "display_name" => "Second"})
             |> json_response(200)

    assert %{"data" => [_only]} =
             authorized_conn()
             |> get(@base_path)
             |> json_response(200)
  end

  test "DELETE removes an alias", %{workspace_path: workspace_path} do
    authorized_conn()
    |> put(@base_path, %{"path" => workspace_path, "display_name" => "Feature"})
    |> json_response(200)

    conn = delete(authorized_conn(), @base_path, %{"path" => workspace_path})
    assert response(conn, 204) == ""
  end

  test "DELETE rejects a non-owned path", %{workspace_path: workspace_path} do
    outside_path = Path.join(Path.dirname(Path.dirname(workspace_path)), "other/workspace")
    conn = delete(authorized_conn(), @base_path, %{"path" => outside_path})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "DELETE maps a missing project to project_not_found", %{workspace_path: workspace_path} do
    conn =
      delete(
        authorized_conn(),
        "/api/tracker/v1/projects/missing/workspaces/display_names",
        %{"path" => workspace_path}
      )

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "project_not_found", "message" => "Project not found"}
           }
  end

  test "DELETE maps an unknown alias on an owned path to alias not found", %{workspace_path: workspace_path} do
    conn = delete(authorized_conn(), @base_path, %{"path" => workspace_path})

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "workspace_display_name_not_found", "message" => "Workspace display name not found"}
           }
  end

  test "PUT rejects invalid and non-project paths", %{workspace_path: workspace_path} do
    conn = put(authorized_conn(), @base_path, %{"path" => "relative", "display_name" => "Feature"})
    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)

    outside_path = Path.join(Path.dirname(Path.dirname(workspace_path)), "other/workspace")
    conn = put(authorized_conn(), @base_path, %{"path" => outside_path, "display_name" => "Feature"})
    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PUT returns 500 when workspace inventory is unavailable", %{workspace_path: workspace_path} do
    use_failing_inventory()

    conn = put(authorized_conn(), @base_path, %{"path" => workspace_path, "display_name" => "Feature"})

    assert json_response(conn, 500) == %{
             "error" => %{"code" => "request_failed", "message" => "Request failed"}
           }
  end

  test "PUT validates display_name before unavailable inventory", %{workspace_path: workspace_path} do
    use_failing_inventory()

    conn = put(authorized_conn(), @base_path, %{"path" => workspace_path, "display_name" => " "})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PUT accepts an existing empty project root emitted by inventory", %{project_root: project_root} do
    conn = put(authorized_conn(), @base_path, %{"path" => project_root, "display_name" => "Project"})

    assert %{"data" => %{"workspace_path" => ^project_root, "display_name" => "Project"}} =
             json_response(conn, 200)
  end

  test "PUT accepts the exact project root when inventory contains it", %{project_root: project_root, tmp: tmp} do
    _shared_repo = GitFixtures.make_repo!(tmp, project_root, "shared")

    conn = put(authorized_conn(), @base_path, %{"path" => project_root, "display_name" => "Project"})

    assert %{"data" => %{"workspace_path" => ^project_root, "display_name" => "Project"}} =
             json_response(conn, 200)
  end

  test "PUT rejects a missing project root", %{project_root: project_root} do
    File.rm_rf!(project_root)

    conn = put(authorized_conn(), @base_path, %{"path" => project_root, "display_name" => "Missing"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PUT rejects lstat failure for a missing path under the project root", %{project_root: project_root} do
    missing_path = Path.join(project_root, "missing-workspace")

    conn = put(authorized_conn(), @base_path, %{"path" => missing_path, "display_name" => "Missing"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PUT rejects a path containing a symlink that escapes the project root", %{
    project_root: project_root,
    tmp: tmp
  } do
    outside_workspace = Path.join(tmp, "outside-workspace")
    _outside_repo = GitFixtures.make_repo!(tmp, outside_workspace, "outside")
    symlink_path = Path.join(project_root, "linked-workspace")
    File.ln_s!(outside_workspace, symlink_path)

    conn = put(authorized_conn(), @base_path, %{"path" => symlink_path, "display_name" => "Linked"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PUT rejects a sibling-prefix path", %{project_root: project_root} do
    sibling_path = project_root <> "-sibling/workspace"

    conn = put(authorized_conn(), @base_path, %{"path" => sibling_path, "display_name" => "Sibling"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "PUT rejects an existing path absent from the current inventory", %{project_root: project_root} do
    untracked_path = Path.join(project_root, "plain-directory")
    File.mkdir_p!(untracked_path)

    conn = put(authorized_conn(), @base_path, %{"path" => untracked_path, "display_name" => "Plain"})

    assert %{"error" => %{"code" => "validation_failed"}} = json_response(conn, 422)
  end

  test "missing project is 404", %{workspace_path: workspace_path} do
    conn =
      put(authorized_conn(), "/api/tracker/v1/projects/missing/workspaces/display_names", %{
        "path" => workspace_path,
        "display_name" => "Feature"
      })

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "project_not_found", "message" => "Project not found"}
           }
  end

  test "unauthenticated requests are 401" do
    conn = get(build_conn(), @base_path)
    assert %{"error" => %{"code" => "unauthorized"}} = json_response(conn, 401)
  end

  defp authorized_conn do
    build_conn() |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(nil), do: System.delete_env(@token_env)
  defp restore_env(value), do: System.put_env(@token_env, value)

  defp use_failing_inventory do
    Application.put_env(
      :symphony_elixir,
      @inventory_module_env,
      SymphonyElixirWeb.Tracker.FailingWorkspaceDisplayNameInventory
    )
  end

  defp restore_inventory_module(nil), do: Application.delete_env(:symphony_elixir, @inventory_module_env)

  defp restore_inventory_module(module),
    do: Application.put_env(:symphony_elixir, @inventory_module_env, module)
end
