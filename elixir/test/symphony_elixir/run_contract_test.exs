defmodule SymphonyElixir.RunContractTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @moduletag :tmp_dir

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

  test "treats remote branch without local upstream tracking as published", %{tmp_dir: tmp_dir} do
    ws = workspace!(tmp_dir)
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "git checkout -b feat/x && echo x > x.md && git add -A && git commit -m x")
    sh!(repo, "git push origin HEAD:feat/x")

    [state] = RunContract.repo_states(ws)

    assert state.branch == "feat/x"
    assert state.upstream?
    assert state.ahead_count == 0

    assert RunContract.evaluate_publish([state], fn _repo -> {:ok, %{url: "https://github.com/o/f/pull/1"}} end) ==
             :satisfied
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

  # --- evaluate_publish/2 --------------------------------------------------

  describe "evaluate_publish/2" do
    defp repo_state(attrs) do
      struct!(
        RepoState,
        Map.merge(%{path: "/tmp/x", name: "frontend", branch: "feat/x", default_branch: "main"}, attrs)
      )
    end

    test "satisfied when no repo has work" do
      states = [repo_state(%{ahead_count: 0, upstream?: true})]
      assert RunContract.evaluate_publish(states, fn _repo -> :none end) == :satisfied
    end

    test "dirty tree is a violation" do
      states = [repo_state(%{dirty?: true})]

      assert {:violations, [%{repo: "frontend", kind: :uncommitted_changes}]} =
               RunContract.evaluate_publish(states, fn _repo -> :none end)
    end

    test "commits without upstream is unpublished_branch" do
      states = [repo_state(%{ahead_count: 2, upstream?: false})]

      assert {:violations, [%{kind: :unpublished_branch}]} =
               RunContract.evaluate_publish(states, fn _repo -> :none end)
    end

    test "pushed branch without PR is missing_pull_request" do
      states = [repo_state(%{ahead_count: 1, upstream?: true})]

      assert {:violations, [%{kind: :missing_pull_request}]} =
               RunContract.evaluate_publish(states, fn _repo -> :none end)
    end

    test "pushed branch with PR is satisfied" do
      states = [repo_state(%{ahead_count: 1, upstream?: true})]
      checker = fn _repo -> {:ok, %{url: "https://github.com/o/r/pull/1", state: "OPEN"}} end
      assert RunContract.evaluate_publish(states, checker) == :satisfied
    end

    test "pr check error is surfaced as violation" do
      states = [repo_state(%{ahead_count: 1, upstream?: true})]

      assert {:violations, [%{kind: :pr_check_failed}]} =
               RunContract.evaluate_publish(states, fn _repo -> {:error, :boom} end)
    end
  end

  describe "pull_requests/2" do
    test "collects PRs for repos with published work" do
      states = [
        struct!(RepoState, %{path: "/a", name: "frontend", branch: "f", ahead_count: 1, upstream?: true}),
        struct!(RepoState, %{path: "/b", name: "backend", branch: "main", ahead_count: 0, upstream?: true})
      ]

      checker = fn
        %RepoState{name: "frontend"} -> {:ok, %{url: "https://github.com/o/f/pull/2", state: "OPEN"}}
        _repo -> :none
      end

      assert [%{repo: "frontend", url: "https://github.com/o/f/pull/2"}] =
               RunContract.pull_requests(states, checker)
    end
  end

  describe "gh_pr_checker/1" do
    test "parses gh pr list output, requires OPEN state and issue marker" do
      open =
        fn "gh", _args, _opts ->
          {~s([{"url":"https://x/pull/1","state":"OPEN","number":1,"title":"t","body":"Symphony-Issue: GAM-9"}]), 0}
        end

      open_no_marker =
        fn "gh", _args, _opts ->
          {~s([{"url":"https://x/pull/1","state":"OPEN","number":1,"title":"t","body":"no marker"}]), 0}
        end

      merged =
        fn "gh", _args, _opts ->
          {~s([{"url":"https://x/pull/1","state":"MERGED","number":1,"title":"t","body":"Symphony-Issue: GAM-9"}]), 0}
        end

      closed = fn "gh", _args, _opts -> {~s([{"url":"https://x/pull/1","state":"CLOSED","number":1,"title":"t"}]), 0} end
      empty = fn "gh", _args, _opts -> {"[]", 0} end
      failing = fn "gh", _args, _opts -> {"gh: auth error", 1} end
      repo = struct!(RepoState, %{path: "/tmp", name: "r", branch: "feat/x"})
      checker = RunContract.gh_pr_checker(issue_identifier: "GAM-9", runner: open)

      assert {:ok, %{url: "https://x/pull/1"}} = checker.(repo)
      assert :none = RunContract.gh_pr_checker(issue_identifier: "GAM-9", runner: open_no_marker).(repo)
      assert :none = RunContract.gh_pr_checker(issue_identifier: "GAM-9", runner: merged).(repo)
      assert :none = RunContract.gh_pr_checker(issue_identifier: "GAM-9", runner: closed).(repo)
      assert :none = RunContract.gh_pr_checker(issue_identifier: "GAM-9", runner: empty).(repo)
      assert {:error, _reason} = RunContract.gh_pr_checker(issue_identifier: "GAM-9", runner: failing).(repo)
    end
  end

  describe "repo_states/2 default_branches" do
    test "configured default_branch prevents default checkout from counting as published work", %{tmp_dir: tmp_dir} do
      ws = workspace!(tmp_dir)
      repo = make_repo!(tmp_dir, ws, "frontend")
      sh!(repo, "git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main")
      sh!(repo, "git update-ref -d refs/remotes/origin/HEAD")

      [state] = RunContract.repo_states(ws, default_branches: %{"frontend" => "main"})

      assert state.branch == "main"
      assert state.default_branch == "main"
      refute RunContract.work_present?([state])

      assert RunContract.pull_requests([state], fn _repo ->
               {:ok, %{url: "https://github.com/o/f/pull/99", state: "OPEN"}}
             end) == []
    end
  end

  describe "summary_text/1" do
    test "renders one line per repo" do
      states = [
        struct!(RepoState, %{path: "/a", name: "frontend", branch: "feat/x", ahead_count: 3, upstream?: false, dirty?: true})
      ]

      text = RunContract.summary_text(states)
      assert text =~ "frontend"
      assert text =~ "commits_ahead=3"
      assert text =~ "pushed=no"
      assert text =~ "uncommitted=yes"
    end
  end
end
