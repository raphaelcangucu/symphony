defmodule SymphonyElixir.RunContract.FinalizerTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Issue
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.Finalizer

  @moduletag :tmp_dir

  defp issue, do: %Issue{id: "uuid-1", identifier: "GAM-9", title: "Do the thing", state: "In Progress"}

  # Delegates git to the real binary; stubs gh. Records gh invocations.
  defp gh_stub_runner(test_pid, pr_url) do
    fn
      "git", args, opts ->
        System.cmd("git", args, opts)

      "gh", ["pr", "list" | _rest] = args, _opts ->
        send(test_pid, {:gh, args})
        {"[]", 0}

      "gh", ["pr", "create" | _rest] = args, _opts ->
        send(test_pid, {:gh, args})
        {pr_url, 0}

      "gh", ["pr", "view" | _rest] = args, _opts ->
        send(test_pid, {:gh, args})
        {~s({"url":"#{pr_url}","number":7,"state":"OPEN","title":"GAM-9: Do the thing"}), 0}
    end
  end

  test "pull_request_body includes the Symphony-Issue marker" do
    body = Finalizer.pull_request_body(issue())
    assert body =~ "Symphony-Issue: GAM-9"
  end

  test "pushes unpublished branch and creates PR (GAM-3 case)", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "git checkout -b docs/gam-9 && echo x > doc.md && git add -A && git commit -m docs")

    assert {:ok, [pr]} = Finalizer.finalize(ws, issue(), runner: gh_stub_runner(self(), "https://github.com/o/f/pull/7"))

    assert pr.repo == "frontend"
    assert pr.url == "https://github.com/o/f/pull/7"
    assert_received {:gh, ["pr", "create" | create_args]}
    assert "--base" in create_args and "main" in create_args

    # Branch is now published
    [state] = RunContract.repo_states(ws)
    assert state.upstream?
  end

  test "commits dirty tree before pushing", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "backend")
    sh!(repo, "git checkout -b fix/gam-9 && echo wip > wip.md")

    assert {:ok, [_pr]} = Finalizer.finalize(ws, issue(), runner: gh_stub_runner(self(), "https://github.com/o/b/pull/8"))

    [state] = RunContract.repo_states(ws)
    refute state.dirty?
    assert state.upstream?
    assert sh!(repo, "git log -1 --format=%s") =~ "chore(GAM-9)"
  end

  test "moves commits off the default branch before pushing", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "goapi")
    sh!(repo, "echo x > new.md && git add -A && git commit -m work")

    assert {:ok, [_pr]} = Finalizer.finalize(ws, issue(), runner: gh_stub_runner(self(), "https://github.com/o/g/pull/9"))

    assert sh!(repo, "git branch --show-current") |> String.trim() == "symphony/gam-9"
  end

  test "clean workspace finalizes to empty PR list", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    make_repo!(tmp_dir, ws, "frontend")

    assert {:ok, []} = Finalizer.finalize(ws, issue(), runner: gh_stub_runner(self(), "unused"))
  end

  test "push failure records partial result and continues other repos", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    bad_repo = make_repo!(tmp_dir, ws, "frontend")
    good_repo = make_repo!(tmp_dir, ws, "backend")

    sh!(bad_repo, "git checkout -b f/x && echo x > x.md && git add -A && git commit -m x && git remote set-url origin /nonexistent")
    sh!(good_repo, "git checkout -b fix/gam-9 && echo y > y.md && git add -A && git commit -m y")

    runner = fn
      "git", args, opts -> System.cmd("git", args, opts)
      "gh", ["pr", "list" | _rest], _opts -> {"[]", 0}
      "gh", ["pr", "create" | _rest], _opts -> {"https://github.com/o/b/pull/11", 0}
      "gh", ["pr", "view" | _rest], _opts ->
        {~s({"url":"https://github.com/o/b/pull/11","number":11,"state":"OPEN","title":"GAM-9: Do the thing"}), 0}
    end

    assert {:partial, [%{repo: "backend", url: "https://github.com/o/b/pull/11"}], [{"frontend", _reason}]} =
             Finalizer.finalize(ws, issue(), runner: runner)
  end

  test "non-fast-forward push is recovered via rebase or fallback branch", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "git checkout -b feat/work && echo work > work.md && git add -A && git commit -m work")
    sh!(repo, "git checkout main && echo remote > remote.md && git add -A && git commit -m remote")
    sh!(repo, "git push origin HEAD:feat/work")
    sh!(repo, "git checkout feat/work")

    assert {:ok, [_pr]} =
             Finalizer.finalize(ws, issue(), runner: gh_stub_runner(self(), "https://github.com/o/f/pull/12"))

    [state] = RunContract.repo_states(ws)
    assert state.upstream?
    assert state.ahead_count == 0
  end
end
