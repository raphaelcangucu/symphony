defmodule SymphonyElixir.Workspace.InventoryTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.GitFixtures
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace.Inventory

  defp size_fun, do: fn _path -> 1_000 end

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    tmp = Path.join(System.tmp_dir!(), "inventory-#{System.unique_integer([:positive])}")
    root = Path.join(tmp, "workspaces")
    File.mkdir_p!(root)

    workflow_file = Path.join(tmp, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file, tracker_kind: "local", workspace_root: root)
    Workflow.set_workflow_file_path(workflow_file)

    {:ok, project} = create_project("invproj")

    on_exit(fn ->
      Application.delete_env(:symphony_elixir, :workflow_file_path)
      File.rm_rf(tmp)
    end)

    {:ok, tmp: tmp, root: root, project: project, segment_root: Path.join(root, "invproj")}
  end

  test "scan classifies issue, parallel, standalone, and project workspaces", ctx do
    active = create_issue!("Active work")
    done = create_issue!("Finished work")
    {:ok, _} = Context.update_issue_state("invproj", done.identifier, "Done")

    active_ws = workspace_dir!(ctx.segment_root, active.identifier)
    done_ws = workspace_dir!(ctx.segment_root, done.identifier)
    parallel_ws = workspace_dir!(ctx.segment_root, active.identifier <> "__p1")
    standalone_ws = workspace_dir!(ctx.segment_root, "__ws_spike")

    # Multi-repo issue workspace: one dirty repo, one clean repo.
    dirty_repo = GitFixtures.make_repo!(ctx.tmp, active_ws, "backend")
    _clean_repo = GitFixtures.make_repo!(ctx.tmp, active_ws, "frontend")
    File.write!(Path.join(dirty_repo, "extra.txt"), "dirty")

    _done_repo = GitFixtures.make_repo!(ctx.tmp, done_ws, "backend")
    _parallel_repo = GitFixtures.make_repo!(ctx.tmp, parallel_ws, "backend")
    _standalone_repo = GitFixtures.make_repo!(ctx.tmp, standalone_ws, "backend")

    # Shared project workspace repo directly under the segment root.
    _project_repo = GitFixtures.make_repo!(ctx.tmp, ctx.segment_root, "shared")

    # Active session pinned to the standalone tree keeps it out of the orphans.
    {:ok, _thread} = History.create_workspace_session_thread("invproj", standalone_ws, %{title: "Spike"})

    executions = [%{issue_identifier: active.identifier, status: :live}]
    {:ok, scan} = Inventory.scan("invproj", executions: executions, size_fun: size_fun())

    by_path = Map.new(scan.workspaces, &{&1.path, &1})

    active_entry = Map.fetch!(by_path, active_ws)
    assert active_entry.kind == :issue
    assert active_entry.issue_identifier == active.identifier
    assert active_entry.classification == :active
    assert active_entry.execution_status == :live
    refute active_entry.removable
    refute active_entry.reclaimable
    assert active_entry.work_present
    assert Enum.map(active_entry.repos, & &1.name) |> Enum.sort() == ["backend", "frontend"]
    assert Enum.find(active_entry.repos, &(&1.name == "backend")).dirty
    refute Enum.find(active_entry.repos, &(&1.name == "frontend")).dirty

    done_entry = Map.fetch!(by_path, done_ws)
    assert done_entry.kind == :issue
    assert done_entry.classification == :orphan
    assert done_entry.reclaimable
    refute done_entry.work_present

    parallel_entry = Map.fetch!(by_path, parallel_ws)
    assert parallel_entry.kind == :issue_parallel
    assert parallel_entry.issue_identifier == active.identifier
    assert parallel_entry.classification == :orphan
    assert parallel_entry.reclaimable

    standalone_entry = Map.fetch!(by_path, standalone_ws)
    assert standalone_entry.kind == :standalone
    assert standalone_entry.name == "spike"
    assert standalone_entry.classification == :active
    refute standalone_entry.reclaimable

    project_entry = Map.fetch!(by_path, ctx.segment_root)
    assert project_entry.kind == :project
    refute project_entry.removable
    assert Enum.map(project_entry.repos, & &1.name) == ["shared"]

    assert scan.totals.count == length(scan.workspaces)
    assert scan.totals.size_bytes > 0
    assert scan.totals.reclaimable_bytes > 0
  end

  test "scan reports orphan workspaces whose issue no longer exists", ctx do
    ghost_ws = workspace_dir!(ctx.segment_root, "GHO-99")
    dirty_repo = GitFixtures.make_repo!(ctx.tmp, ghost_ws, "backend")
    File.write!(Path.join(dirty_repo, "wip.txt"), "unpublished")

    {:ok, scan} = Inventory.scan("invproj", executions: [], size_fun: size_fun())
    entry = Enum.find(scan.workspaces, &(&1.path == ghost_ws))

    assert entry.kind == :unknown
    assert entry.classification == :orphan
    assert entry.work_present
    refute entry.reclaimable
  end

  test "scan emits kind:project for an empty segment root", ctx do
    File.mkdir_p!(ctx.segment_root)

    {:ok, scan} = Inventory.scan("invproj", executions: [], size_fun: size_fun())
    entry = Enum.find(scan.workspaces, &(&1.path == Path.expand(ctx.segment_root)))

    assert entry
    assert entry.kind == :project
    assert entry.repos == []
    refute entry.removable
    refute entry.reclaimable
  end

  test "scan_stream emits each workspace entry and totals", ctx do
    active = create_issue!("Active work")
    active_ws = workspace_dir!(ctx.segment_root, active.identifier)
    _repo = GitFixtures.make_repo!(ctx.tmp, active_ws, "backend")

    events = Agent.start_link(fn -> [] end) |> elem(1)

    emit = fn event ->
      Agent.update(events, &[event | &1])
      :ok
    end

    assert {:ok, scan} = Inventory.scan_stream("invproj", emit, executions: [], size_fun: size_fun())
    emitted = Agent.get(events, &Enum.reverse/1)

    assert length(scan.workspaces) == 1
    assert {:entry, %{path: ^active_ws}} = Enum.at(emitted, 0)
    assert {:totals, %{count: 1}} = List.last(emitted)
  end

  test "scan omits a workspace whose probe exceeds the per-scan deadline", ctx do
    slow = create_issue!("Slow probe")
    fast = create_issue!("Fast probe")
    slow_ws = workspace_dir!(ctx.segment_root, slow.identifier)
    fast_ws = workspace_dir!(ctx.segment_root, fast.identifier)
    _slow_repo = GitFixtures.make_repo!(ctx.tmp, slow_ws, "backend")
    _fast_repo = GitFixtures.make_repo!(ctx.tmp, fast_ws, "backend")

    slow_size_fun = fn path ->
      if String.starts_with?(path, slow_ws) do
        Process.sleep(3_000)
        1_000
      else
        1_000
      end
    end

    {:ok, scan} =
      Inventory.scan("invproj", executions: [], size_fun: slow_size_fun, scan_timeout: 500)

    paths = Enum.map(scan.workspaces, & &1.path)
    refute slow_ws in paths
    assert fast_ws in paths
  end

  test "scan returns {:error, :timeout} when the overall gather deadline is exceeded", ctx do
    issue = create_issue!("Hangs forever")
    ws = workspace_dir!(ctx.segment_root, issue.identifier)
    _repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    hanging_size_fun = fn _path ->
      Process.sleep(3_000)
      1_000
    end

    assert {:error, :timeout} =
             Inventory.scan("invproj",
               executions: [],
               size_fun: hanging_size_fun,
               overall_timeout: 0
             )
  end

  test "scan lists child worktrees nested under a workspace repo", ctx do
    issue = create_issue!("Bundle parent")
    ws = workspace_dir!(ctx.segment_root, issue.identifier)
    repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    {:ok, worktree_path} = SymphonyElixir.Workspace.Worktree.ensure(repo, "child-1", "feat/child-1")

    {:ok, scan} = Inventory.scan("invproj", executions: [], size_fun: size_fun())
    entry = Enum.find(scan.workspaces, &(&1.path == ws))

    assert [child] = entry.child_worktrees
    assert child.path == worktree_path
    assert child.repo_name == "backend"
    assert child.slug == "child-1"
    assert child.branch == "feat/child-1"
  end

  test "remove skips paths outside the root, live executions, and the root itself", ctx do
    issue = create_issue!("Running work")
    ws = workspace_dir!(ctx.segment_root, issue.identifier)
    _repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    outside = Path.join(System.tmp_dir!(), "not-a-workspace")

    executions = [%{issue_identifier: issue.identifier, status: :live}]

    {:ok, results} =
      Inventory.remove("invproj", [outside, ctx.segment_root, ws], executions: executions)

    by_path = Map.new(results, &{&1.path, &1})

    assert by_path[Path.expand(outside)].status == :skipped
    assert by_path[ctx.segment_root].status == :skipped
    assert by_path[ws].status == :skipped
    assert by_path[ws].reason =~ "live execution"
    assert File.dir?(ws)
  end

  test "remove deletes an orphan workspace and detaches child worktrees", ctx do
    issue = create_issue!("Old work")
    ws = workspace_dir!(ctx.segment_root, issue.identifier)
    repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")
    {:ok, worktree_path} = SymphonyElixir.Workspace.Worktree.ensure(repo, "child-2", "feat/child-2")

    {:ok, results} = Inventory.remove("invproj", [worktree_path, ws], executions: [])

    assert Enum.all?(results, &(&1.status == :removed))
    refute File.exists?(worktree_path)
    refute File.exists?(ws)
  end

  test "remove reports actionable permission errors for undeletable nested files", ctx do
    issue = create_issue!("Locked nested files")
    ws = workspace_dir!(ctx.segment_root, issue.identifier)
    nested = Path.join(ws, "nested")
    File.mkdir_p!(nested)
    File.write!(Path.join(nested, "owned.txt"), "x\n")
    # Strip write from the parent so File.rm_rf cannot unlink children.
    File.chmod!(nested, 0o500)
    File.chmod!(ws, 0o500)

    {:ok, results} = Inventory.remove("invproj", [ws], executions: [])
    [result] = results

    assert result.status == :skipped
    assert result.reason =~ "permission denied deleting"
    assert result.reason =~ "Docker-owned"

    File.chmod!(ws, 0o700)
    File.chmod!(nested, 0o700)
    File.rm_rf!(ws)
  end

  test "remove deletes workspace under project-specific root outside process workspace root", ctx do
    global_root = Path.join(ctx.tmp, "process-workspaces")
    project_root = Path.join(ctx.tmp, "project-workspaces")
    File.mkdir_p!(global_root)
    File.mkdir_p!(project_root)

    workflow_file = Path.join(ctx.tmp, "WORKFLOW-global.md")

    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: global_root
    )

    Workflow.set_workflow_file_path(workflow_file)

    markdown = Workflow.to_markdown(%{"workspace" => %{"root" => project_root}}, "")
    assert {:ok, _} = Context.upsert_project_setup("invproj", %{"workflow_markdown" => markdown})

    segment_root = Path.join(project_root, "invproj")
    issue = create_issue!("Custom root work")
    ws = workspace_dir!(segment_root, issue.identifier)
    _repo = GitFixtures.make_repo!(ctx.tmp, ws, "backend")

    assert Path.expand(SymphonyElixir.Config.workspace_root()) == Path.expand(global_root)
    refute String.starts_with?(Path.expand(ws) <> "/", Path.expand(global_root) <> "/")

    {:ok, results} = Inventory.remove("invproj", [ws], executions: [])
    expanded = Path.expand(ws)

    assert [%{path: ^expanded, status: :removed, reason: nil}] = results
    refute File.exists?(ws)
  end

  defp workspace_dir!(segment_root, name) do
    path = Path.join(segment_root, name)
    File.mkdir_p!(path)
    path
  end

  defp create_issue!(title) do
    {:ok, issue} = Context.create_issue("invproj", %{"title" => title})
    issue
  end

  defp create_project(slug) do
    Context.create_workspace_project(%{
      "name" => String.upcase(slug),
      "slug" => slug,
      "workflow_statuses" => [
        %{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false},
        %{"name" => "Done", "category" => "completed", "position" => 1, "is_terminal" => true}
      ],
      "repositories" => [],
      "setup" => %{}
    })
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
