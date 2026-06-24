defmodule SymphonyElixir.AgentRunnerWorktreeTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Issue

  setup do
    repo = Path.join(System.tmp_dir!(), "ar-wt-#{System.unique_integer([:positive])}")
    File.mkdir_p!(repo)
    {_, 0} = System.cmd("git", ["init", "-q"], cd: repo)
    File.write!(Path.join(repo, "README.md"), "x")
    {_, 0} = System.cmd("git", ["add", "."], cd: repo)
    {_, 0} = System.cmd("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], cd: repo)
    on_exit(fn -> File.rm_rf!(repo) end)
    {:ok, repo: repo}
  end

  test "resolve_workspace returns an isolated worktree when worktree: true", %{repo: repo} do
    issue = %Issue{identifier: "CHILD-1"}

    {:ok, path} = AgentRunner.resolve_workspace(issue, worktree: true, worktree_repo: repo, unit_id: "be")

    assert File.dir?(path)
    assert path =~ ".worktrees"
    {out, 0} = System.cmd("git", ["worktree", "list"], cd: repo)
    assert out =~ "be"
  end

  test "resolve_workspace errors when the worktree repo is missing" do
    issue = %Issue{identifier: "CHILD-1"}
    assert {:error, :missing_worktree_repo} = AgentRunner.resolve_workspace(issue, worktree: true)
  end
end
