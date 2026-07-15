defmodule SymphonyElixir.KnowledgeBase.IssueWorkspaceTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.KnowledgeBase.IssueWorkspace
  alias SymphonyElixir.LocalTracker.{Context, Repository}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    root = Path.join(System.tmp_dir!(), "issue-kb-#{System.unique_integer([:positive])}")
    workspace_root = Path.join(root, "workspaces")
    workflow = Path.join(root, "WORKFLOW.md")
    previous_workflow_path = Workflow.workflow_file_path()

    File.mkdir_p!(workspace_root)
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, tracker_kind: "local", workspace_root: workspace_root)
    Workflow.set_workflow_file_path(workflow)

    {:ok, project} = Context.ensure_project(%{name: "Macro", slug: "macro"})

    {:ok, _repo} =
      %Repository{}
      |> Repository.changeset(%{
        project_id: project.id,
        github_full_name: "acme/back",
        workspace_path: "back",
        role: "primary",
        default_branch: "main",
        selected_branch: "main"
      })
      |> Repo.insert()

    issue_root = Path.join(workspace_root, "MAC-1")
    repo_root = Path.join(issue_root, "back")
    File.mkdir_p!(Path.join(repo_root, "docs/market"))
    git(repo_root, ["init", "-q", "-b", "main"])
    File.write!(Path.join(repo_root, "docs/unchanged.md"), "# Unchanged\n")
    File.write!(Path.join(repo_root, "docs/market/original.md"), "# Original\n")
    git(repo_root, ["add", "-A"])
    git(repo_root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base docs"])

    git(repo_root, ["checkout", "-q", "-b", "task/mac-1"])
    File.write!(Path.join(repo_root, "docs/market/original.md"), "# Original changed\n")
    File.write!(Path.join(repo_root, "docs/market/committed.md"), "# Committed\n")
    git(repo_root, ["add", "docs/market/original.md", "docs/market/committed.md"])
    git(repo_root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "task docs"])
    File.write!(Path.join(repo_root, "docs/market/uncommitted.md"), "# Uncommitted\n")

    {:ok, _thread} = History.ensure_issue_thread("macro", "MAC-1", %{workspace_path: issue_root})

    on_exit(fn ->
      Workflow.set_workflow_file_path(previous_workflow_path)
      File.rm_rf(root)
    end)

    {:ok, repo_root: repo_root}
  end

  test "repo_tree includes only docs changed against the base branch" do
    assert {:ok, result} = IssueWorkspace.repo_tree("macro", "MAC-1", "back")
    paths = flatten_paths(result.tree)

    assert "market/original.md" in paths
    assert "market/committed.md" in paths
    assert "market/uncommitted.md" in paths
    refute "unchanged.md" in paths
  end

  test "read_page and save_page use the issue worktree docs" do
    assert {:ok, page} = IssueWorkspace.read_page("macro", "MAC-1", "back", "market/original.md")
    assert page.body =~ "Original changed"

    assert {:ok, %{path: "market/original.md", commit: :workspace}} =
             IssueWorkspace.write_page("macro", "MAC-1", "back", "market/original.md", %{
               frontmatter: %{},
               body: "# Edited in task\n"
             })

    assert {:ok, page} = IssueWorkspace.read_page("macro", "MAC-1", "back", "market/original.md")
    assert page.body == "# Edited in task\n"
  end

  test "repo_tree returns repo_not_checked_out when the worktree has no git checkout" do
    issue_root = Path.join(System.tmp_dir!(), "issue-kb-missing-git-#{System.unique_integer([:positive])}")
    repo_root = Path.join(issue_root, "back")
    File.mkdir_p!(Path.join(repo_root, "docs"))
    File.write!(Path.join(repo_root, "docs/staged.md"), "# Staged\n")

    {:ok, _thread} = History.ensure_issue_thread("macro", "MAC-NO-GIT", %{workspace_path: issue_root})

    assert IssueWorkspace.repo_tree("macro", "MAC-NO-GIT", "back") == {:error, :repo_not_checked_out}

    on_exit(fn -> File.rm_rf(issue_root) end)
  end

  defp flatten_paths(nodes) do
    Enum.flat_map(nodes, fn
      %{type: :folder, children: children} -> flatten_paths(children)
      %{path: path} -> [path]
    end)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp git(dir, args), do: {_out, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
