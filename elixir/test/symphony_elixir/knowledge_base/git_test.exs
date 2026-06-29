defmodule SymphonyElixir.KnowledgeBase.GitTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Git

  setup do
    base = Path.join(System.tmp_dir!(), "kb-git-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    File.mkdir_p!(checkout)
    sh(checkout, ["init", "-q", "-b", "main"])

    sh(checkout, [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "init"
    ])

    on_exit(fn -> File.rm_rf(base) end)
    {:ok, checkout: checkout, base: base}
  end

  test "ensure_worktree creates a worktree on a new branch and is idempotent", %{
    checkout: checkout
  } do
    assert {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    assert File.dir?(wt)
    assert {:ok, "symphony-docs"} = Git.current_branch(wt)
    assert {:ok, ^wt} = Git.ensure_worktree(checkout, "symphony-docs")
  end

  test "ensure_worktree self-heals an unborn worktree once the checkout has commits" do
    base = Path.join(System.tmp_dir!(), "kb-heal-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    File.mkdir_p!(checkout)
    on_exit(fn -> File.rm_rf(base) end)

    # Repository with no commits yet — mimics a clone that is still in progress,
    # so the docs worktree is created from an unborn HEAD (the production bug).
    sh(checkout, ["init", "-q", "-b", "main"])
    assert {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    refute worktree_born?(wt)

    # The default branch lands its first commit (the clone completes).
    File.mkdir_p!(Path.join(checkout, "docs"))
    File.write!(Path.join(checkout, "docs/PAGE.md"), "# page\n")
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "docs/PAGE.md"])
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"])

    # A later ensure must rebuild the worktree from the now-available base.
    assert {:ok, ^wt} = Git.ensure_worktree(checkout, "symphony-docs", base_branch: "main")
    assert worktree_born?(wt)
    assert {:ok, "symphony-docs"} = Git.current_branch(wt)
    assert File.exists?(Path.join(wt, "docs/PAGE.md"))
  end

  test "ensure_worktree keeps the orphan branch for a commitless repository" do
    base = Path.join(System.tmp_dir!(), "kb-empty-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    File.mkdir_p!(checkout)
    on_exit(fn -> File.rm_rf(base) end)

    # A genuinely empty repository (e.g. a brand-new general KB) has no base to
    # heal to, so the orphan branch must be preserved for the first write to seed.
    sh(checkout, ["init", "-q", "-b", "main"])
    assert {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    refute worktree_born?(wt)

    assert {:ok, ^wt} = Git.ensure_worktree(checkout, "symphony-docs")
    refute worktree_born?(wt)
    assert {:ok, "symphony-docs"} = Git.current_branch(wt)
  end

  test "add + commit persist a file on the worktree branch", %{checkout: checkout} do
    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    File.mkdir_p!(Path.join(wt, "docs"))
    File.write!(Path.join(wt, "docs/x.md"), "# x\n")

    assert :ok = Git.add(wt, ["docs/x.md"])
    assert {:ok, sha} = Git.commit(wt, "docs(kb): add x", name: "Bot", email: "bot@s")
    assert is_binary(sha) and byte_size(sha) >= 7
    assert {:ok, ""} = Git.status_porcelain(wt)
  end

  test "push sends the branch to a bare origin", %{checkout: checkout, base: base} do
    origin = Path.join(base, "origin.git")
    sh(File.cwd!(), ["init", "--bare", "-q", origin])
    sh(checkout, ["remote", "add", "origin", origin])

    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    File.write!(Path.join(wt, "f.txt"), "hi")
    :ok = Git.add(wt, ["f.txt"])
    {:ok, _} = Git.commit(wt, "msg", name: "B", email: "b@s")

    assert :ok = Git.push(wt, "symphony-docs")

    assert {output, 0} =
             System.cmd("git", ["ls-remote", "--heads", origin, "symphony-docs"], stderr_to_stdout: true)

    assert output =~ "symphony-docs"
  end

  test "push integrates remote docs branch updates before retrying", %{checkout: checkout, base: base} do
    origin = Path.join(base, "origin.git")
    sh(File.cwd!(), ["init", "--bare", "-q", "-b", "main", origin])
    sh(checkout, ["remote", "add", "origin", origin])
    sh(checkout, ["push", "-q", "-u", "origin", "main"])

    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    File.write!(Path.join(wt, "first.txt"), "first")
    :ok = Git.add(wt, ["first.txt"])
    {:ok, _} = Git.commit(wt, "first docs", name: "B", email: "b@s")
    assert :ok = Git.push(wt, "symphony-docs")

    other = Path.join(base, "other")
    {_o, 0} = System.cmd("git", ["clone", "-q", origin, other], stderr_to_stdout: true)
    sh(other, ["checkout", "-q", "symphony-docs"])
    File.write!(Path.join(other, "remote.txt"), "remote")
    sh(other, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"])
    sh(other, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "remote docs"])
    sh(other, ["push", "-q", "origin", "symphony-docs"])

    File.write!(Path.join(wt, "local.txt"), "local")
    :ok = Git.add(wt, ["local.txt"])
    {:ok, _} = Git.commit(wt, "local docs", name: "B", email: "b@s")

    assert :ok = Git.push(wt, "symphony-docs")

    verify = Path.join(base, "verify")
    {_o, 0} = System.cmd("git", ["clone", "-q", "--branch", "symphony-docs", origin, verify], stderr_to_stdout: true)
    assert File.read!(Path.join(verify, "remote.txt")) == "remote"
    assert File.read!(Path.join(verify, "local.txt")) == "local"
  end

  test "merge brings in origin changes and reports merged", %{checkout: checkout, base: base} do
    origin = Path.join(base, "origin.git")
    {_o, 0} = System.cmd("git", ["init", "--bare", "-q", "-b", "main", origin], stderr_to_stdout: true)
    sh(checkout, ["remote", "add", "origin", origin])
    sh(checkout, ["push", "-q", "origin", "main"])

    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")

    other = Path.join(base, "clone")
    {_o, 0} = System.cmd("git", ["clone", "-q", origin, other], stderr_to_stdout: true)
    File.write!(Path.join(other, "from-main.txt"), "x")
    sh(other, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"])
    sh(other, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "main change"])
    sh(other, ["push", "-q", "origin", "main"])

    assert :ok = Git.fetch(wt)
    assert {:ok, :merged} = Git.merge(wt, "origin/main")
    assert File.exists?(Path.join(wt, "from-main.txt"))
  end

  test "merge reports up_to_date when there is nothing to merge", %{checkout: checkout} do
    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    assert {:ok, :up_to_date} = Git.merge(wt, "main")
  end

  test "merge returns a conflict error and aborts the merge", %{checkout: checkout} do
    File.write!(Path.join(checkout, "conflict.txt"), "base\n")
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"])
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base file"])

    sh(checkout, ["checkout", "-q", "-b", "other"])
    File.write!(Path.join(checkout, "conflict.txt"), "other-change\n")
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-aqm", "other change"])
    sh(checkout, ["checkout", "-q", "main"])

    {:ok, wt} = Git.ensure_worktree(checkout, "symphony-docs")
    File.write!(Path.join(wt, "conflict.txt"), "docs-change\n")
    :ok = Git.add(wt, ["conflict.txt"])
    {:ok, _} = Git.commit(wt, "docs change", name: "B", email: "b@s")

    assert {:error, :merge_conflict} = Git.merge(wt, "other")
    assert {:ok, ""} = Git.status_porcelain(wt)
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)

  defp worktree_born?(worktree) do
    match?(
      {_o, 0},
      System.cmd("git", ["rev-parse", "--verify", "--quiet", "HEAD"],
        cd: worktree,
        stderr_to_stdout: true
      )
    )
  end
end
