defmodule SymphonyElixir.Evidence.CommitsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Evidence.Commits

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    repo = Path.join(tmp_dir, "advising")
    File.mkdir_p!(repo)
    sh!(repo, "git init -b main")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    sh!(repo, "git checkout -b feature/test")
    sh!(repo, "echo change > feature.txt && git add feature.txt && git commit -m 'feat: add feature'")
    sh!(repo, "echo tweak >> feature.txt && git add feature.txt && git commit -m 'fix: tweak feature'")
    sh!(repo, "git remote add origin .")
    sh!(repo, "git update-ref refs/remotes/origin/main main")
    sh!(repo, "git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main")

    workspace = Path.join(tmp_dir, "CDE-1")
    File.mkdir_p!(workspace)
    File.rename!(repo, Path.join(workspace, "advising"))

    %{workspace: workspace}
  end

  test "lists commits ahead of main for workspace repos", %{workspace: workspace} do
    assert {:ok, %{commits: commits, total: 2, next_cursor: nil}} = Commits.list(workspace)
    assert length(commits) == 2
    assert Enum.all?(commits, &(&1.repo == "advising"))
    assert Enum.at(commits, 0).message =~ "tweak"
    assert Enum.all?(commits, &(&1.online == false))
  end

  test "paginates commits with limit and cursor", %{workspace: workspace} do
    assert {:ok, %{commits: [first], total: 2, limit: 1, next_cursor: cursor}} =
             Commits.list(workspace, limit: 1)

    assert is_binary(cursor)
    assert first.message =~ "tweak"

    assert {:ok, %{commits: [second], total: 2, next_cursor: nil}} =
             Commits.list(workspace, limit: 1, cursor: cursor)

    assert second.message =~ "add feature"
  end

  test "marks pushed feature-branch commits as online", %{workspace: workspace} do
    repo = Path.join(workspace, "advising")
    assert {:ok, %{commits: [newest, older]}} = Commits.list(workspace)
    assert newest.online == false
    assert older.online == false

    # Publish only the older commit to origin/feature/test; leave newest local.
    sh!(repo, "git update-ref refs/remotes/origin/feature/test #{older.sha}")
    sh!(repo, "git branch --set-upstream-to=origin/feature/test feature/test")

    assert {:ok, %{commits: [latest, pushed]}} = Commits.list(workspace)
    assert latest.sha == newest.sha
    assert latest.online == false
    assert pushed.sha == older.sha
    assert pushed.online == true
  end

  test "page commits include numstat after light index", %{workspace: workspace} do
    assert {:ok, %{commits: [latest | _]}} = Commits.list(workspace, limit: 1)
    assert latest.insertions >= 1
    assert latest.files_changed >= 1
  end

  test "serves a second list call from hotpath cache without changing results", %{workspace: workspace} do
    assert {:ok, first} = Commits.list(workspace, limit: 2)
    assert {:ok, second} = Commits.list(workspace, limit: 2)
    assert second.commits == first.commits
    assert second.total == first.total
  end

  test "shows commit diff files", %{workspace: workspace} do
    assert {:ok, %{commits: commits}} = Commits.list(workspace)
    [latest | _] = commits

    assert {:ok, detail} = Commits.show(workspace, "advising", latest.sha)
    assert detail.message =~ "tweak"
    assert [%{path: "feature.txt", status: "modified", patch: patch} | _] = detail.files
    assert patch =~ "feature.txt"
  end

  test "returns empty page when workspace is missing" do
    assert {:ok, %{commits: [], total: 0, next_cursor: nil}} =
             Commits.list("/tmp/does-not-exist-#{System.unique_integer()}")
  end

  test "lists commits using project default_branches when origin/HEAD is unset", %{tmp_dir: tmp_dir} do
    repo = Path.join(tmp_dir, "back")
    File.mkdir_p!(repo)
    sh!(repo, "git init -b dev")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    sh!(repo, "git checkout -b feature/symphony")
    sh!(repo, "echo work > work.txt && git add work.txt && git commit -m 'feat: agent work'")
    sh!(repo, "git remote add origin .")
    sh!(repo, "git update-ref refs/remotes/origin/dev dev")
    # Shallow-clone style: no origin/HEAD symbolic ref.

    workspace = Path.join(tmp_dir, "MAC-535")
    File.mkdir_p!(workspace)
    File.rename!(repo, Path.join(workspace, "back"))

    assert {:ok, %{commits: []}} = Commits.list(workspace)

    assert {:ok, %{commits: [commit]}} = Commits.list(workspace, default_branches: %{"back" => "dev"})
    assert commit.repo == "back"
    assert commit.message =~ "agent work"
  end

  test "falls back to a resolvable integration ref when configured default is missing", %{tmp_dir: tmp_dir} do
    repo = Path.join(tmp_dir, "advising")
    File.mkdir_p!(repo)
    sh!(repo, "git init -b pre-release")
    sh!(repo, ~s(git config user.email "agent@test.local"))
    sh!(repo, "git config user.name \"Symphony Agent\"")
    sh!(repo, "echo base > README.md && git add README.md && git commit -m 'chore: base'")
    sh!(repo, "git checkout -b feature/graphql")
    sh!(repo, "echo work > work.txt && git add work.txt && git commit -m 'feat: graphql work'")
    sh!(repo, "git remote add origin .")
    sh!(repo, "git update-ref refs/remotes/origin/pre-release pre-release")
    # Configured default points at a stale feature branch that is not on origin.
    # Also no origin/HEAD — same shape as shallow advising clones.

    workspace = Path.join(tmp_dir, "CDE-1131")
    File.mkdir_p!(workspace)
    File.rename!(repo, Path.join(workspace, "advising"))

    assert {:ok, %{commits: [commit]}} =
             Commits.list(workspace,
               default_branches: %{"advising" => "feature/lti-group-sharing-CDE-1106"}
             )

    assert commit.repo == "advising"
    assert commit.message =~ "graphql work"
  end

  defp sh!(cwd, command) do
    {output, status} = System.cmd("bash", ["-lc", command], cd: cwd, stderr_to_stdout: true)
    assert status == 0, output
    output
  end
end
