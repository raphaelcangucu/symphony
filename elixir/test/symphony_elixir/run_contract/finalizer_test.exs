defmodule SymphonyElixir.RunContract.FinalizerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.Finalizer

  @moduletag :tmp_dir

  defp sh!(dir, cmd) do
    {out, 0} = System.cmd("sh", ["-lc", cmd], cd: dir, stderr_to_stdout: true)
    out
  end

  defp make_repo!(tmp_dir, workspace, name) do
    origin = Path.join(tmp_dir, "#{name}-origin.git")
    repo = Path.join(workspace, name)
    File.mkdir_p!(origin)
    File.mkdir_p!(repo)
    sh!(origin, "git init --bare -b main .")

    sh!(repo, """
    git init -b main . &&
    git config user.email t@t && git config user.name t &&
    echo hello > README.md && git add -A && git commit -m init &&
    git remote add origin "#{origin}" && git push -u origin main &&
    git remote set-head origin main
    """)

    repo
  end

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

  test "push failure halts with repo context", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "git checkout -b f/x && echo x > x.md && git add -A && git commit -m x && git remote set-url origin /nonexistent")

    runner = fn cmd, args, opts -> System.cmd(cmd, args, opts) end
    assert {:error, {"frontend", _reason}} = Finalizer.finalize(ws, issue(), runner: runner)
  end
end
