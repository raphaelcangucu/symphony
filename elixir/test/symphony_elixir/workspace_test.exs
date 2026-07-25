defmodule SymphonyElixir.WorkspaceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.{Issue, Repo, Workflow, Workspace}
  alias SymphonyElixir.LocalTracker.Context

  setup do
    migrate_repo()
    clean_repo()
    previous_skills_root = Application.get_env(:symphony_elixir, :skills_root)

    workspace_root =
      Path.join(System.tmp_dir!(), "symphony-workspace-nested-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace_root)
    skills_root = Path.join(workspace_root, "_skills")
    write_skill!(Path.join(skills_root, "superpowers"), "subagent-driven-development")
    Application.put_env(:symphony_elixir, :skills_root, skills_root)

    workflow_file = Path.join(workspace_root, "WORKFLOW.md")

    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: workspace_root
    )

    Workflow.set_workflow_file_path(workflow_file)

    on_exit(fn ->
      Workflow.clear_workflow_file_path()
      restore_skills_root(previous_skills_root)
      File.rm_rf!(workspace_root)
    end)

    {:ok, workspace_root: workspace_root, workflow_file: workflow_file}
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

  test "path_for_issue/1 nests under the issue project's github repo, not a flat slug", %{
    workspace_root: root
  } do
    {:ok, _project} =
      Context.ensure_project(%{
        name: "dm",
        slug: "dm",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/distributionmachine", "project_id" => "PVT_x"}
      })

    issue = %Issue{id: "DIS-1", identifier: "DIS-1", project_slug: "dm"}

    assert Workspace.path_for_issue(issue) ==
             Path.join([root, "clouapp/distributionmachine", "DIS-1"])
  end

  test "path_for_issue/1 resolves identically from an identifier-only input and an issue map", %{
    workspace_root: root
  } do
    {:ok, _project} =
      Context.ensure_project(%{
        name: "dm",
        slug: "dm",
        tracker_kind: "github",
        tracker_config: %{"repo" => "clouapp/distributionmachine", "project_id" => "PVT_x"}
      })

    {:ok, issue} = Context.create_issue("dm", %{title: "Remover menu duplicado"})

    from_map = Workspace.path_for_issue(%{id: issue.id, identifier: issue.identifier, project_slug: "dm"})
    from_slug_map = Workspace.path_for_issue(%{identifier: issue.identifier, project_slug: "dm"})
    from_identifier = Workspace.path_for_issue(issue.identifier)

    assert from_map == from_slug_map
    assert from_map == from_identifier
    assert String.starts_with?(from_map, Path.join(root, "clouapp/distributionmachine") <> "/")
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

  test "create_for_issue/1 prepares agent skills after running the after_create hook", %{
    workspace_root: root,
    workflow_file: workflow_file
  } do
    SymphonyElixir.TestSupport.write_workflow_file!(workflow_file,
      tracker_kind: "local",
      workspace_root: root,
      hook_after_create: "git init -b main front"
    )

    issue = %Issue{project_slug: "alpha", identifier: "A-2"}
    workspace = Path.join([root, "alpha", "A-2"])
    front = Path.join(workspace, "front")

    assert {:ok, ^workspace} = Workspace.create_for_issue(issue)
    assert File.dir?(front)
    assert File.regular?(Path.join([workspace, ".codex", "skills", "subagent-driven-development", "SKILL.md"]))

    assert File.regular?(Path.join([front, ".claude", "skills", "subagent-driven-development", "SKILL.md"]))

    refute File.exists?(Path.join([workspace, ".codex", "skills", "brainstorming", "SKILL.md"]))

    exclude = File.read!(Path.join([front, ".git", "info", "exclude"]))
    assert exclude =~ "/.codex/"
    assert exclude =~ "/.claude/"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end

  defp write_skill!(root, name) do
    dir = Path.join(root, name)
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "SKILL.md"), "# #{name}\n")
  end

  defp restore_skills_root(nil), do: Application.delete_env(:symphony_elixir, :skills_root)
  defp restore_skills_root(value), do: Application.put_env(:symphony_elixir, :skills_root, value)
end
