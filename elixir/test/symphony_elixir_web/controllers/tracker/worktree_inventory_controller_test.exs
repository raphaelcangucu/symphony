defmodule SymphonyElixirWeb.Tracker.FailingWorktreeInventoryDisplayName do
  @moduledoc false

  def map_for_project(_project_slug), do: {:error, :workspace_alias_lookup_failed}
end

defmodule SymphonyElixirWeb.Tracker.StatefulWorktreeInventoryDisplayName do
  @moduledoc false

  def map_for_project(_project_slug) do
    agent = Application.fetch_env!(:symphony_elixir, :worktree_inventory_display_name_fake_agent)

    Agent.get_and_update(agent, fn %{calls: calls, snapshots: [snapshot | remaining]} ->
      {snapshot, %{calls: calls + 1, snapshots: remaining}}
    end)
  end
end

defmodule SymphonyElixirWeb.Tracker.WorktreeInventoryControllerTest do
  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.GitFixtures
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workspace.DisplayName
  alias SymphonyElixir.Workflow

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"
  @display_name_module_env :worktree_inventory_display_name_module
  @display_name_fake_agent_env :worktree_inventory_display_name_fake_agent

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    previous_token = System.get_env(@token_env)
    previous_display_name_module = Application.get_env(:symphony_elixir, @display_name_module_env)
    previous_display_name_fake_agent = Application.get_env(:symphony_elixir, @display_name_fake_agent_env)
    System.put_env(@token_env, "secret")
    Application.delete_env(:symphony_elixir, @display_name_module_env)
    Application.delete_env(:symphony_elixir, @display_name_fake_agent_env)

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
      restore_display_name_module(previous_display_name_module)
      restore_display_name_fake_agent(previous_display_name_fake_agent)
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

  test "GET /worktrees includes a nil display name on every entry without aliases", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "No alias"})
    workspace_path = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(workspace_path)

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")

    assert %{"data" => entries} = json_response(conn, 200)
    assert entries != []
    assert Enum.all?(entries, &Map.has_key?(&1, "display_name"))
    assert Enum.all?(entries, &is_nil(&1["display_name"]))
  end

  test "GET /worktrees includes an alias for the exact workspace path", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Aliased"})
    workspace_path = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(workspace_path)
    assert {:ok, _alias} = DisplayName.put("wtapi", workspace_path, "Review API")

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")

    assert %{"data" => entries} = json_response(conn, 200)
    assert %{"display_name" => "Review API"} = Enum.find(entries, &(&1["path"] == workspace_path))
  end

  test "GET /worktrees loads one alias snapshot for every entry", ctx do
    workspace_paths =
      for title <- ["First snapshot", "Second snapshot"] do
        {:ok, issue} = Context.create_issue("wtapi", %{"title" => title})
        workspace_path = Path.join(ctx.segment_root, issue.identifier)
        File.mkdir_p!(workspace_path)
        workspace_path
      end

    [first_path, second_path] = workspace_paths

    fake_agent =
      use_stateful_display_name_fake([
        {:ok, %{first_path => "First alias", second_path => "Second alias"}},
        {:ok, %{first_path => "Changed first", second_path => "Changed second"}}
      ])

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")

    assert %{"data" => entries} = json_response(conn, 200)
    entries_by_path = Map.new(entries, &{&1["path"], &1})
    assert entries_by_path[first_path]["display_name"] == "First alias"
    assert entries_by_path[second_path]["display_name"] == "Second alias"
    assert %{calls: 1} = Agent.get(fake_agent, & &1)
  end

  test "GET /worktrees does not attach sibling-prefix or normalized-near-match aliases", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Exact only"})
    workspace_path = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(workspace_path)
    assert {:ok, project} = Context.get_project("wtapi")
    assert {:ok, _alias} = DisplayName.put("wtapi", workspace_path <> "-copy", "Sibling")

    Repo.insert!(%DisplayName{
      project_id: project.id,
      project_slug: project.slug,
      workspace_path: workspace_path <> "/.",
      display_name: "Normalized near match"
    })

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")

    assert %{"data" => entries} = json_response(conn, 200)
    assert %{"display_name" => nil} = Enum.find(entries, &(&1["path"] == workspace_path))
  end

  test "GET /worktrees ignores a stale alias whose workspace is absent", ctx do
    stale_path = Path.join(ctx.segment_root, "missing-workspace")
    assert {:ok, _alias} = DisplayName.put("wtapi", stale_path, "Removed workspace")

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")

    assert %{"data" => entries} = json_response(conn, 200)
    refute Enum.any?(entries, &(&1["path"] == stale_path))
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

  test "GET /worktrees/events includes the GET display name in its entry event", ctx do
    {:ok, issue} = Context.create_issue("wtapi", %{"title" => "Stream alias"})
    workspace_path = Path.join(ctx.segment_root, issue.identifier)
    File.mkdir_p!(workspace_path)
    assert {:ok, _alias} = DisplayName.put("wtapi", workspace_path, "Streaming API")

    get_conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")
    assert %{"data" => entries} = json_response(get_conn, 200)
    assert %{"display_name" => display_name} = Enum.find(entries, &(&1["path"] == workspace_path))

    stream_conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees/events")

    assert stream_conn.resp_body =~ "event: entry"
    assert stream_conn.resp_body =~ Jason.encode!(display_name)
    assert stream_conn.resp_body =~ Jason.encode!(workspace_path)
  end

  test "GET /worktrees/events loads one immutable alias snapshot for all entry events", ctx do
    workspace_paths =
      for title <- ["First stream snapshot", "Second stream snapshot"] do
        {:ok, issue} = Context.create_issue("wtapi", %{"title" => title})
        workspace_path = Path.join(ctx.segment_root, issue.identifier)
        File.mkdir_p!(workspace_path)
        workspace_path
      end

    [first_path, second_path] = workspace_paths

    fake_agent =
      use_stateful_display_name_fake([
        {:ok, %{first_path => "First stream alias", second_path => "Second stream alias"}},
        {:ok, %{first_path => "Changed first", second_path => "Changed second"}}
      ])

    conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees/events")

    entries_by_path =
      conn.resp_body
      |> sse_entry_data()
      |> Map.new(&{&1["path"], &1})

    assert entries_by_path[first_path]["display_name"] == "First stream alias"
    assert entries_by_path[second_path]["display_name"] == "Second stream alias"
    assert %{calls: 1} = Agent.get(fake_agent, & &1)
  end

  test "alias lookup failures use existing GET and SSE inventory error conventions" do
    Application.put_env(
      :symphony_elixir,
      @display_name_module_env,
      SymphonyElixirWeb.Tracker.FailingWorktreeInventoryDisplayName
    )

    get_conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees")
    assert %{"error" => %{"code" => "request_failed"}} = json_response(get_conn, 500)

    stream_conn = get(authorize(), "/api/tracker/v1/projects/wtapi/worktrees/events")
    assert stream_conn.status == 200
    assert stream_conn.resp_body =~ "event: failure"
    assert stream_conn.resp_body =~ "workspace_alias_lookup_failed"
    refute stream_conn.resp_body =~ "event: done"
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
    refute File.dir?(thread.workspace_path)
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

  defp restore_display_name_module(nil),
    do: Application.delete_env(:symphony_elixir, @display_name_module_env)

  defp restore_display_name_module(module),
    do: Application.put_env(:symphony_elixir, @display_name_module_env, module)

  defp use_stateful_display_name_fake(snapshots) do
    {:ok, agent} = Agent.start_link(fn -> %{calls: 0, snapshots: snapshots} end)

    Application.put_env(
      :symphony_elixir,
      @display_name_module_env,
      SymphonyElixirWeb.Tracker.StatefulWorktreeInventoryDisplayName
    )

    Application.put_env(:symphony_elixir, @display_name_fake_agent_env, agent)
    agent
  end

  defp sse_entry_data(body) do
    body
    |> String.split("\n\n", trim: true)
    |> Enum.flat_map(fn event ->
      lines = String.split(event, "\n")

      if "event: entry" in lines do
        data_line = Enum.find(lines, &String.starts_with?(&1, "data: "))
        [%{"data" => data}] = [data_line |> String.replace_prefix("data: ", "") |> Jason.decode!()]
        [data]
      else
        []
      end
    end)
  end

  defp restore_display_name_fake_agent(nil),
    do: Application.delete_env(:symphony_elixir, @display_name_fake_agent_env)

  defp restore_display_name_fake_agent(agent),
    do: Application.put_env(:symphony_elixir, @display_name_fake_agent_env, agent)
end
