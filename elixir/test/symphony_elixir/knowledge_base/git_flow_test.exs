defmodule SymphonyElixir.KnowledgeBase.GitFlowTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.KnowledgeBase.{GitFlow, Workspace}

  defmodule PrStub do
    def rest_get("/repos/acme/web", _),
      do: {:ok, %{status: 200, body: %{"default_branch" => "main"}}}

    def rest_get("/repos/acme/web/pulls" <> _, _), do: {:ok, %{status: 200, body: []}}

    def rest_post("/repos/acme/web/pulls", _b, _),
      do: {:ok, %{status: 201, body: %{"number" => 11, "html_url" => "u"}}}
  end

  setup do
    base = Path.join(System.tmp_dir!(), "kb-flow-#{System.unique_integer([:positive])}")
    checkout = Path.join(base, "repo")
    origin = Path.join(base, "origin.git")
    File.mkdir_p!(checkout)
    {_o, 0} = System.cmd("git", ["init", "--bare", "-q", "-b", "main", origin], stderr_to_stdout: true)
    sh(checkout, ["init", "-q", "-b", "main"])
    sh(checkout, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"])
    sh(checkout, ["remote", "add", "origin", origin])
    sh(checkout, ["push", "-q", "-u", "origin", "main"])
    {:ok, ws} = Workspace.ensure(checkout)
    on_exit(fn -> File.rm_rf(base) end)
    {:ok, ws: ws}
  end

  test "sync_branch merges origin/main and pushes the checkout branch", %{ws: ws} do
    assert {:ok, _} = GitFlow.sync_branch(ws, "main")

    assert {output, 0} =
             System.cmd("git", ["branch", "--show-current"],
               cd: ws.worktree,
               stderr_to_stdout: true
             )

    assert String.trim(output) == ws.branch
  end

  test "pending_changes? is false when the docs branch mirrors the default branch", %{ws: ws} do
    assert {:ok, _} = GitFlow.sync_branch(ws, "main")
    refute GitFlow.pending_changes?(ws, "main")
  end

  test "pending_changes? is true once the docs branch has a new commit", %{ws: ws} do
    assert {:ok, _} = GitFlow.sync_branch(ws, "main")
    File.write!(Path.join(ws.worktree, "docs-note.md"), "# note\n")
    sh(ws.worktree, ["add", "-A"])
    sh(ws.worktree, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "edit"])
    assert GitFlow.pending_changes?(ws, "main")
  end

  test "ensure_pull_request returns a PR via the injected client", %{ws: _ws} do
    assert {:ok, %{number: 11, created: true}} =
             GitFlow.ensure_pull_request("acme/web", "symphony-docs", client: PrStub)
  end

  test "evaluate_and_merge merges when checks are green" do
    deps = [
      detail: fn "acme/web", 11, _ ->
        {:ok, %{checks_state: "SUCCESS", mergeable: true, any_running: false}}
      end,
      merge: fn _project, 11, "squash", _ -> {:ok, %{merged: true}} end
    ]

    assert {:ok, :merged} = GitFlow.evaluate_and_merge(%{repo: "acme/web", project: :proj}, 11, deps)
  end

  test "evaluate_and_merge reschedules while checks pending" do
    deps = [
      detail: fn _, _, _ -> {:ok, %{checks_state: "PENDING", mergeable: nil, any_running: true}} end,
      merge: fn _, _, _, _ -> flunk("should not merge") end
    ]

    assert {:ok, :pending} = GitFlow.evaluate_and_merge(%{repo: "acme/web", project: :proj}, 11, deps)
  end

  test "evaluate_and_merge stops on failed checks" do
    deps = [
      detail: fn _, _, _ -> {:ok, %{checks_state: "FAILURE", mergeable: false, any_running: false}} end,
      merge: fn _, _, _, _ -> flunk("should not merge") end
    ]

    assert {:error, :kb_checks_failed} =
             GitFlow.evaluate_and_merge(%{repo: "acme/web", project: :proj}, 11, deps)
  end

  defp sh(dir, args), do: {_o, 0} = System.cmd("git", args, cd: dir, stderr_to_stdout: true)
end
