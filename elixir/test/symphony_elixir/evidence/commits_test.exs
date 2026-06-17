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
    assert {:ok, commits} = Commits.list(workspace)
    assert length(commits) == 2
    assert Enum.all?(commits, &(&1.repo == "advising"))
    assert Enum.at(commits, 0).message =~ "tweak"
  end

  test "shows commit diff files", %{workspace: workspace} do
    assert {:ok, commits} = Commits.list(workspace)
    [latest | _] = commits

    assert {:ok, detail} = Commits.show(workspace, "advising", latest.sha)
    assert detail.message =~ "tweak"
    assert [%{path: "feature.txt", status: "modified", patch: patch} | _] = detail.files
    assert patch =~ "feature.txt"
  end

  test "returns empty list when workspace is missing" do
    assert {:ok, []} = Commits.list("/tmp/does-not-exist-#{System.unique_integer()}")
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

    assert {:ok, []} = Commits.list(workspace)

    assert {:ok, [commit]} = Commits.list(workspace, default_branches: %{"back" => "dev"})
    assert commit.repo == "back"
    assert commit.message =~ "agent work"
  end

  defp sh!(cwd, command) do
    {output, status} = System.cmd("bash", ["-lc", command], cd: cwd, stderr_to_stdout: true)
    assert status == 0, output
    output
  end
end
