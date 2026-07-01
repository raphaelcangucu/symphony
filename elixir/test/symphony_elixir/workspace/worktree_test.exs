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

  test "ensure/4 lazily creates the parent integration branch and forks the child off it", %{repo: repo} do
    base = "symphony/510/clouapp-back"

    {:ok, path} = Worktree.ensure(repo, "child-301", "feat/child-301", base)

    assert File.dir?(path)
    {branches, 0} = System.cmd("git", ["branch", "--list", base], cd: repo)
    assert branches =~ base

    {head, 0} = System.cmd("git", ["rev-parse", "--abbrev-ref", "HEAD"], cd: path)
    assert String.trim(head) == "feat/child-301"

    # The child branch forks from the integration branch tip.
    {merge_base, 0} = System.cmd("git", ["merge-base", "feat/child-301", base], cd: repo)
    {base_tip, 0} = System.cmd("git", ["rev-parse", base], cd: repo)
    assert String.trim(merge_base) == String.trim(base_tip)
  end

  test "ensure/4 forks a second sibling off the same already-created integration branch", %{repo: repo} do
    base = "symphony/510/clouapp-back"

    {:ok, _first} = Worktree.ensure(repo, "child-401", "feat/child-401", base)
    {:ok, _second} = Worktree.ensure(repo, "child-402", "feat/child-402", base)

    {list, 0} = System.cmd("git", ["worktree", "list"], cd: repo)
    assert list =~ "feat/child-401"
    assert list =~ "feat/child-402"
  end

  test "remove/2 detaches the worktree", %{repo: repo} do
    {:ok, path} = Worktree.ensure(repo, "child-202", "feat/child-202")
    assert :ok = Worktree.remove(repo, path)
    {out, 0} = System.cmd("git", ["worktree", "list"], cd: repo)
    refute out =~ "child-202"
  end
end
