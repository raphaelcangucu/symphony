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
end
