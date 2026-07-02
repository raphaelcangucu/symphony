defmodule SymphonyElixir.KnowledgeBase.WorkspaceTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.Workspace

  setup do
    base = Path.join(System.tmp_dir!(), "kb-ws-#{System.unique_integer([:positive])}")
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
    {:ok, checkout: checkout}
  end

  test "ensure returns the base checkout docs directory", %{checkout: checkout} do
    assert {:ok, %{worktree: wt, docs_root: docs, branch: "main"}} = Workspace.ensure(checkout)
    assert wt == checkout
    assert docs == Path.join(checkout, "docs")
    assert File.dir?(Path.join(docs, "assets"))
    assert {:ok, "main"} = SymphonyElixir.KnowledgeBase.Git.current_branch(wt)
  end

  test "ensure errors when the checkout is not a git repo" do
    missing = Path.join(System.tmp_dir!(), "kb-not-a-repo-#{System.unique_integer([:positive])}")
    File.mkdir_p!(missing)
    assert {:error, _} = Workspace.ensure(missing)
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
