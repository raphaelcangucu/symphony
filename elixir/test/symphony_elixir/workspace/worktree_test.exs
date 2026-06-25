defmodule SymphonyElixir.Workspace.WorktreeTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Workspace.Worktree

  setup do
    repo = Path.join(System.tmp_dir!(), "wt-#{System.unique_integer([:positive])}")
    File.mkdir_p!(repo)
    {_, 0} = System.cmd("git", ["init", "-q"], cd: repo)
    File.write!(Path.join(repo, "README.md"), "x")
    {_, 0} = System.cmd("git", ["add", "."], cd: repo)
    {_, 0} = System.cmd("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], cd: repo)
    on_exit(fn -> File.rm_rf!(repo) end)
    {:ok, repo: repo}
  end

  test "ensure/3 creates an isolated worktree on a feature branch", %{repo: repo} do
    {:ok, path} = Worktree.ensure(repo, "child-101", "feat/child-101")
    assert File.dir?(path)
    {out, 0} = System.cmd("git", ["worktree", "list"], cd: repo)
    assert out =~ "feat/child-101"
  end

  test "ensure/3 is idempotent for an existing worktree", %{repo: repo} do
    {:ok, path1} = Worktree.ensure(repo, "child-101", "feat/child-101")
    {:ok, path2} = Worktree.ensure(repo, "child-101", "feat/child-101")
    assert path1 == path2
  end

  test "remove/2 detaches the worktree", %{repo: repo} do
    {:ok, path} = Worktree.ensure(repo, "child-202", "feat/child-202")
    assert :ok = Worktree.remove(repo, path)
    {out, 0} = System.cmd("git", ["worktree", "list"], cd: repo)
    refute out =~ "child-202"
  end
end
