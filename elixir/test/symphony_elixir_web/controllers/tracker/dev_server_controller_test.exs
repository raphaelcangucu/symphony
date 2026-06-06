defmodule SymphonyElixirWeb.Tracker.DevServerControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @workflow_statuses [
    %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
  ]

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    workflow_root = Path.join(System.tmp_dir!(), "symphony-dev-server-controller-workflow-#{System.unique_integer([:positive])}")
    workspace_root = Path.join(System.tmp_dir!(), "symphony-dev-server-controller-workspaces-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workflow_root)
    File.mkdir_p!(workspace_root)

    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow_file)

    migrate_repo()
    clean_repo()

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => @workflow_statuses,
        "repositories" => [],
        "setup" => %{}
      })

    {:ok, issue} = Context.create_issue("p", %{"title" => "Preview issue", "status" => "Todo"})

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(workflow_root)
      File.rm_rf(workspace_root)
    end)

    {:ok, identifier: issue.identifier}
  end

  test "index returns availability and servers for an existing project", %{identifier: identifier} do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers")

    assert json_response(conn, 200) == %{
             "data" => %{
               "available" => false,
               "reason" => "disabled",
               "servers" => [],
               "tunnel" => %{"enabled" => false, "running" => false}
             }
           }
  end

  test "index returns 404 for an unknown project" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/missing/issues/P-1/dev_servers")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "project_not_found", "message" => "Project not found"}
           }
  end

  test "index returns 404 for an unknown issue" do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/p/issues/P-404/dev_servers")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
           }
  end

  test "start returns 404 for an unknown issue" do
    conn = post(authorized_conn(), "/api/tracker/v1/projects/p/issues/P-404/dev_servers/start")

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "issue_not_found", "message" => "Issue not found"}
           }
  end

  test "start stop and restart return the current disabled view", %{identifier: identifier} do
    for action <- ["start", "stop", "restart"] do
      conn = post(authorized_conn(), "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers/#{action}")

      assert json_response(conn, 200) == %{
               "data" => %{
                 "available" => false,
                 "reason" => "disabled",
                 "servers" => [],
                 "tunnel" => %{"enabled" => false, "running" => false}
               }
             }
    end
  end

  test "per-server start stop and restart return 404 for an unknown server", %{identifier: identifier} do
    for action <- ["start", "stop", "restart"] do
      conn =
        post(
          authorized_conn(),
          "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers/999/#{action}"
        )

      assert json_response(conn, 404) == %{
               "error" => %{"code" => "dev_server_not_found", "message" => "Dev server not found"}
             }
    end
  end

  test "per-server actions reject invalid server ids", %{identifier: identifier} do
    conn =
      post(
        authorized_conn(),
        "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers/not-a-number/start"
      )

    assert json_response(conn, 422) == %{
             "error" => %{
               "code" => "validation_failed",
               "details" => %{},
               "message" => "server_id must be a positive integer"
             }
           }
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
