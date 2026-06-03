defmodule SymphonyElixir.WorkspaceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.{Issue, Repo, Workflow, Workspace}

  setup do
    migrate_repo()
    clean_repo()

    workspace_root =
      Path.join(System.tmp_dir!(), "symphony-workspace-nested-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace_root)
    workflow_file = Path.join(workspace_root, "WORKFLOW.md")

    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: workspace_root
    )

    Workflow.set_workflow_file_path(workflow_file)
    if Process.whereis(SymphonyElixir.WorkflowStore), do: SymphonyElixir.WorkflowStore.force_reload()

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      File.rm_rf!(workspace_root)
    end)

    {:ok, workspace_root: workspace_root}
  end

  test "create_for_issue/1 nests the workspace under the project slug", %{workspace_root: root} do
    issue = %Issue{project_slug: "alpha", identifier: "A-1"}
    nested = Path.join([root, "alpha", "A-1"])

    assert {:ok, ^nested} = Workspace.create_for_issue(issue)
    assert File.dir?(nested)
  end

  test "path_for_issue/1 returns the nested path for an issue carrying a project slug", %{workspace_root: root} do
    issue = %Issue{project_slug: "alpha", identifier: "A-1"}

    assert Workspace.path_for_issue(issue) == Path.join([root, "alpha", "A-1"])
  end

  test "path_for_issue/1 falls back to the flat path when no project resolves", %{workspace_root: root} do
    assert Workspace.path_for_issue("loose-id") == Path.join(root, "loose-id")
  end

  test "remove_issue_workspaces/1 sweeps nested project subdirectories", %{workspace_root: root} do
    issue = %Issue{project_slug: "alpha", identifier: "A-1"}
    nested = Path.join([root, "alpha", "A-1"])

    assert {:ok, ^nested} = Workspace.create_for_issue(issue)
    assert File.dir?(nested)

    assert :ok = Workspace.remove_issue_workspaces("A-1")
    refute File.exists?(nested)
  end

  test "remove_issue_workspaces/1 sweeps github two-level nested workspaces", %{workspace_root: root} do
    nested = Path.join([root, "owner", "name", "A-1"])
    File.mkdir_p!(nested)
    assert File.dir?(nested)

    assert :ok = Workspace.remove_issue_workspaces("A-1")
    refute File.exists?(nested)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
