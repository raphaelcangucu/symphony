defmodule SymphonyElixir.Workspace.IssueBranchesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, Project, ProjectSetup}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow
  alias SymphonyElixir.Workspace.IssueBranches

  setup do
    migrate_repo()
    tmp = Path.join(System.tmp_dir!(), "symphony-issue-branches-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp)
    repo = Path.join(tmp, "app")
    File.mkdir_p!(repo)
    git!(repo, ["init", "-q", "-b", "main"])
    git!(repo, ["config", "user.email", "test@example.com"])
    git!(repo, ["config", "user.name", "Test"])
    on_exit(fn -> File.rm_rf!(tmp) end)
    {:ok, workspace: tmp, repo: repo}
  end

  test "checks out a new branch from the project branch pattern", %{workspace: workspace, repo: repo} do
    slug = "branch-pattern-#{System.unique_integer([:positive])}"
    project = insert_project!(slug, "symphony/{issue}")

    assert :ok = IssueBranches.ensure(workspace, project.slug, "CDE-1131")
    assert git!(repo, ["branch", "--show-current"]) == "symphony/CDE-1131"
  end

  test "reuses an existing local branch", %{workspace: workspace, repo: repo} do
    slug = "existing-branch-#{System.unique_integer([:positive])}"
    project = insert_project!(slug, "symphony/{issue}")
    git!(repo, ["checkout", "-q", "-b", "symphony/CDE-9"])

    assert :ok = IssueBranches.ensure(workspace, project.slug, "CDE-9")
    assert git!(repo, ["branch", "--show-current"]) == "symphony/CDE-9"
  end

  defp insert_project!(slug, branch_pattern) do
    {:ok, project} = Context.ensure_project(%{name: slug, slug: slug, tracker_kind: "local"})

    {:ok, _setup} =
      %ProjectSetup{}
      |> ProjectSetup.changeset(%{
        project_id: project.id,
        workflow_markdown:
          Workflow.to_markdown(%{"source_control" => %{"branch_pattern" => branch_pattern}}, ""),
        validation_commands: %{"commands" => []},
        scan_summary: %{}
      })
      |> Repo.insert()

    Repo.get!(Project, project.id) |> Repo.preload(:setup)
  end

  defp git!(path, args) do
    {output, 0} = System.cmd("git", args, cd: path, stderr_to_stdout: true)
    String.trim(output)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
