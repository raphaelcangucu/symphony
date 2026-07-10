defmodule SymphonyElixirWeb.Tracker.WorktreeInventoryControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.GitFixtures
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    tmp = Path.join(System.tmp_dir!(), "wt-api-#{System.unique_integer([:positive])}")
    root = Path.join(tmp, "workspaces")
    File.mkdir_p!(root)

    workflow_file = Path.join(tmp, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: root)
    Workflow.set_workflow_file_path(workflow_file)

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "WTAPI",
        "slug" => "wtapi",
        "workflow_statuses" => [
          %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false},
          %{"name" => "Done", "category" => "completed", "position" => 1, "is_terminal" => true}
        ],
        "repositories" => [],
        "setup" => %{}
      })

    on_exit(fn ->
      restore_env(@token_env, previous_token)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(tmp)
    end)

    {:ok, tmp: tmp, root: root, segment_root: Path.join(root, "wtapi")}
  end

  test "GET /worktrees returns the project inventory with totals", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Work"})
    ws = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(ws)
    _repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")

    assert %{"data" => data, "totals" => totals} = json_response(conn, 200)
    entry = Enum.find(data, &(&1["path"] == ws))
    assert entry["kind"] == "issue"
    assert entry["issue_identifier"] == issue.identifier
    assert entry["classification"] == "active"
    assert [repo] = entry["repos"]
    assert repo["name"] == "backend"
    assert is_integer(totals["size_bytes"])
  end

  test "GET /worktrees returns 404 for unknown project" do
    conn = get(authorize(), "/api/tracker/v1/projects/nope/worktrees")
    assert json_response(conn, 404)
  end

  test "GET /worktrees/events streams entries and totals", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Stream"})
    ws = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(ws)
    _repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees/events")

    assert get_resp_header(conn, "content-type") == ["text/event-stream; charset=utf-8"]
    assert conn.resp_body =~ "event: entry"
    assert conn.resp_body =~ issue.identifier
    assert conn.resp_body =~ "event: totals"
    assert conn.resp_body =~ "event: done"
  end

  test "GET /worktrees/events accepts token query param for EventSource auth", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Stream auth"})
    ws = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(ws)
    _repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    conn = get(build_conn(), "/api/tracker/v1/projects/wtapi/worktrees/events?token=secret")

    assert get_resp_header(conn, "content-type") == ["text/event-stream; charset=utf-8"]
    assert conn.resp_body =~ "event: done"
  end

  test "DELETE /worktrees removes listed workspaces and reports skips", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Old"})
    {:ok, _} = Context.update_issue_state("wtapi", issue.identifier, "Done")
    ws = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(ws)
    _repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    outside = Path.join(System.tmp_dir!(), "outside-tree")

    conn =
      authorize()
      |> delete("/api/tracker/v1/projects/wtapi/worktrees", %{paths: [ws, outside]})

    assert %{"data" => results} = json_response(conn, 200)
    by_path = Map.new(results, &{&1["path"], &1})

    assert by_path[ws]["status"] == "removed"
    assert by_path[Path.expand(outside)]["status"] == "skipped"
    refute File.exists?(ws)
  end

  test "DELETE /worktrees without paths returns 422" do
    conn = delete(authorize(), "/api/tracker/v1/projects/wtapi/worktrees", %{})
    assert json_response(conn, 422)
  end

  test "POST /workspaces creates a standalone workspace with an initial session", ctx do
    conn =
      authorize()
      |> post("/api/tracker/v1/projects/wtapi/workspaces", %{name: "spike cache"})

    assert %{"data" => %{"workspace_path" => path, "thread" => thread}} = json_response(conn, 201)
    assert path == Path.join(ctx.segment_root, "__ws_spike-cache")
    assert File.dir?(path)
    assert thread["scope"] == "project_session"

    {:ok, persisted} = History.get_thread(thread["id"])
    assert persisted.workspace_path == path
  end

  test "POST /workspaces rejects a duplicate name", ctx do
    File.mkdir_p!(Path.join(ctx.segment_root, "__ws_dup"))

    conn =
      authorize()
      |> post("/api/tracker/v1/projects/wtapi/workspaces", %{name: "dup"})

    assert %{"error" => %{"message" => message}} = json_response(conn, 422)
    assert message =~ "already exists"
  end

  test "POST /workspaces rejects an empty name" do
    conn =
      authorize()
      |> post("/api/tracker/v1/projects/wtapi/workspaces", %{name: "  "})

    assert json_response(conn, 422)
  end

  test "POST issue_session with isolated_workspace pins the thread to a parallel tree", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Parallel"})
    ws = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(ws)

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "wtapi",
        issue_identifier: issue.identifier,
        title: "Isolated pass",
        isolated_workspace: true
      })

    assert %{"data" => %{"id" => id}} = json_response(conn, 201)
    {:ok, thread} = History.get_thread(id)

    assert thread.workspace_path == ws <> "__p1"
    assert File.dir?(thread.workspace_path)
    assert thread.metadata["workspace_kind"] == "isolated"
  end

  test "POST issue_session with use_parent_workspace pins the thread to the parent tree", ctx do
    {:ok, parent} = Context.create_issue("wtapi", %{"title" => "Parent"})
    {:ok, child} = Context.create_issue("wtapi", %{"title" => "Child"})
    {:ok, _} = Context.add_blocker("wtapi", child.identifier, parent.identifier, "sub_issue_of")

    parent_ws = Path.join(ctx.segment_root, parent.identifier)
    File.mkdir_p!(parent_ws)

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "wtapi",
        issue_identifier: child.identifier,
        title: "Reuse parent",
        use_parent_workspace: true
      })

    assert %{"data" => %{"id" => id}} = json_response(conn, 201)
    {:ok, thread} = History.get_thread(id)

    assert thread.workspace_path == parent_ws
    assert thread.metadata["workspace_kind"] == "parent"
    assert thread.metadata["parent_workspace_issue"] == parent.identifier
  end

  test "POST issue_session with use_parent_workspace fails when the issue has no parent" do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Orphan"})

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "wtapi",
        issue_identifier: issue.identifier,
        title: "No parent",
        use_parent_workspace: true
      })

    assert %{"error" => %{"code" => "no_parent_issue"}} = json_response(conn, 422)
  end

  test "POST issue_session without the flag shares the issue tree", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Shared"})

    conn =
      authorize()
      |> post("/api/tracker/v1/assistant/threads", %{
        scope: "issue_session",
        project_slug: "wtapi",
        issue_identifier: issue.identifier,
        title: "Shared pass"
      })

    assert %{"data" => %{"id" => id}} = json_response(conn, 201)
    {:ok, thread} = History.get_thread(id)

    assert thread.workspace_path == Path.join(ctx.segment_root, issue.identifier)
    assert thread.metadata["workspace_kind"] == "shared"
  end

  defp authorize do
    build_conn()
    |> put_req_header("authorization", "Bearer secret")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
