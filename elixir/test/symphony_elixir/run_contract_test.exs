defmodule SymphonyElixir.RunContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @moduletag :tmp_dir

  # --- git fixture helpers -------------------------------------------------

  defp sh!(dir, cmd) do
    {out, 0} = System.cmd("sh", ["-lc", cmd], cd: dir, stderr_to_stdout: true)
    out
  end

  # Creates origin (bare) + a clone at workspace/<name> with one commit on `main`.
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

  defp workspace!(tmp_dir) do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    ws
  end

  # --- repo_states/1 -------------------------------------------------------

  test "clean multi-repo workspace has no work", %{tmp_dir: tmp_dir} do
    ws = workspace!(tmp_dir)
    make_repo!(tmp_dir, ws, "frontend")
    make_repo!(tmp_dir, ws, "backend")

    states = RunContract.repo_states(ws)

    assert [%RepoState{name: "backend"}, %RepoState{name: "frontend"}] = states
    refute RunContract.work_present?(states)
    assert Enum.all?(states, &(&1.branch == "main" and &1.upstream? and &1.ahead_count == 0))
  end

  test "detects unpushed branch with commits (GAM-3 case)", %{tmp_dir: tmp_dir} do
    ws = workspace!(tmp_dir)
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "git checkout -b docs/gam-3 && echo x > doc.md && git add -A && git commit -m docs")

    [state] = RunContract.repo_states(ws)

    assert %RepoState{branch: "docs/gam-3", upstream?: false, ahead_count: 1, dirty?: false, default_branch: "main"} =
             state

    assert RunContract.work_present?([state])
  end

  test "detects dirty working tree", %{tmp_dir: tmp_dir} do
    ws = workspace!(tmp_dir)
    repo = make_repo!(tmp_dir, ws, "backend")
    sh!(repo, "echo dirty >> README.md")

    [state] = RunContract.repo_states(ws)
    assert state.dirty?
    assert RunContract.work_present?([state])
  end

  test "workspace that is itself a repo yields one state", %{tmp_dir: tmp_dir} do
    ws = make_repo!(tmp_dir, tmp_dir, "solo")
    assert [%RepoState{name: "solo"}] = RunContract.repo_states(ws)
  end

  test "missing or empty workspace yields no states", %{tmp_dir: tmp_dir} do
    assert RunContract.repo_states(Path.join(tmp_dir, "nope")) == []
  end
end
