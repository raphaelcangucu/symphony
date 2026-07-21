defmodule SymphonyElixirWeb.Tracker.DevServerControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.{Context, DevEnv, DevServerRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.TestSupport
  alias SymphonyElixir.Workflow

  defmodule OutputStreamTmux do
    @moduledoc false
    def capture_pane(_session_name), do: {:ok, "setup complete\n"}
  end

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @workflow_statuses [
    %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}
  ]

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    Application.put_env(:symphony_elixir, :cloudflare_tunnel_checker, fn -> false end)

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
    thread_workspace_path = Path.join(workspace_root, "thread-preview")
    File.mkdir_p!(thread_workspace_path)

    {:ok, thread} =
      History.create_workspace_session_thread("p", thread_workspace_path, %{
        title: "Thread preview"
      })

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      Application.delete_env(:symphony_elixir, :cloudflare_tunnel_checker)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(workflow_root)
      File.rm_rf(workspace_root)
    end)

    {:ok, identifier: issue.identifier, thread_id: thread.id, thread_workspace_path: thread_workspace_path}
  end

  test "index returns availability and servers for an existing project", %{identifier: identifier} do
    conn = get(authorized_conn(), "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers")

    assert_disabled_snapshot(json_response(conn, 200))
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

      assert_disabled_snapshot(json_response(conn, 200))
    end
  end

  test "thread index and start use workspace-path records without synthetic issue identifiers", %{
    thread_id: thread_id,
    thread_workspace_path: workspace_path
  } do
    {:ok, _steps} =
      DevEnv.save_steps("p", [
        %{
          description: "Front",
          command: "npm run dev",
          role: "serve",
          working_dir: "front"
        }
      ])

    for {method, path} <- [
          {:get, "/api/tracker/v1/assistant/threads/#{thread_id}/dev_servers"},
          {:post, "/api/tracker/v1/assistant/threads/#{thread_id}/dev_servers/start"}
        ] do
      conn =
        case method do
          :get -> get(authorized_conn(), path)
          :post -> post(authorized_conn(), path)
        end

      assert %{
               "data" => %{
                 "available" => false,
                 "reason" => "disabled",
                 "servers" => [%{"slug" => "front"}]
               }
             } = json_response(conn, 200)
    end

    {:ok, project} = Context.get_project("p")

    assert [%DevServerRecord{workspace_path: ^workspace_path, issue_identifier: nil}] =
             DevServerRecord.list_for_workspace(project.id, workspace_path)
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

  test "output returns 404 for an unknown server", %{identifier: identifier} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers/999/output"
      )

    assert json_response(conn, 404) == %{
             "error" => %{"code" => "dev_server_not_found", "message" => "Dev server not found"}
           }
  end

  test "output events returns 404 for an unknown server", %{identifier: identifier} do
    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers/999/output/events"
      )

    assert get_resp_header(conn, "content-type") == ["text/event-stream; charset=utf-8"]
    assert conn.resp_body =~ "dev_server_not_found"
  end

  test "output events streams a snapshot and closes for terminal servers", %{identifier: identifier} do
    previous_poll_ms = Application.get_env(:symphony_elixir, :dev_server_output_poll_ms)
    previous_tmux = Application.get_env(:symphony_elixir, :terminal_tmux)
    Application.put_env(:symphony_elixir, :dev_server_output_poll_ms, 0)
    Application.put_env(:symphony_elixir, :terminal_tmux, OutputStreamTmux)

    on_exit(fn ->
      restore_env_value(:symphony_elixir, :dev_server_output_poll_ms, previous_poll_ms)
      restore_env_value(:symphony_elixir, :terminal_tmux, previous_tmux)
    end)

    {:ok, project} = Context.get_project("p")

    {:ok, record} =
      SymphonyElixir.LocalTracker.DevServerRecord.upsert(project.id, identifier, "goapi", %{
        working_dir: "goapi",
        port: 4102,
        url: "http://127.0.0.1:4102/graphiql",
        status: "ready",
        primary: false,
        session_name: "sym-dev-goapi"
      })

    conn =
      get(
        authorized_conn(),
        "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers/#{record.id}/output/events"
      )

    assert get_resp_header(conn, "content-type") == ["text/event-stream; charset=utf-8"]
    assert conn.resp_body =~ "event: snapshot"
    assert conn.resp_body =~ "setup complete"
    assert conn.resp_body =~ "event: done"
    assert conn.resp_body =~ ~s("status":"ready")
  end

  test "output events accepts token query param for EventSource auth", %{identifier: identifier} do
    conn =
      get(
        build_conn(),
        "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers/999/output/events?token=secret"
      )

    assert get_resp_header(conn, "content-type") == ["text/event-stream; charset=utf-8"]
    assert conn.resp_body =~ "dev_server_not_found"
  end

  test "index accepts token query param for EventSource auth", %{identifier: identifier} do
    conn = get(build_conn(), "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers?token=secret")

    assert_disabled_snapshot(json_response(conn, 200))
  end

  test "index reports project-level public tunnel as enabled even when process WORKFLOW disables it", %{
    identifier: identifier
  } do
    {:ok, _setup} =
      Context.upsert_project_setup("p", %{
        "workflow_markdown" => """
        ---
        dev_server:
          enabled: true
        public_tunnel:
          enabled: true
          base_domain: tracker.cods.dev
        ---
        """
      })

    conn = get(authorized_conn(), "/api/tracker/v1/projects/p/issues/#{identifier}/dev_servers")

    assert json_response(conn, 200)["data"]["tunnel"] == %{"enabled" => true, "running" => false}
  end

  defp authorized_conn do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  # The unified PreviewSnapshot payload carries stable availability fields plus a
  # non-deterministic snapshot_id/as_of; assert the stable subset and type-check
  # the dynamic identity fields.
  defp assert_disabled_snapshot(response) do
    assert %{"data" => data} = response
    assert data["available"] == false
    assert data["reason"] == "disabled"
    assert data["servers"] == []
    assert data["tunnel"] == %{"enabled" => false, "running" => false}
    assert is_binary(data["snapshot_id"])
    assert is_binary(data["as_of"])
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

  defp restore_env_value(app, key, nil), do: Application.delete_env(app, key)
  defp restore_env_value(app, key, value), do: Application.put_env(app, key, value)
end
