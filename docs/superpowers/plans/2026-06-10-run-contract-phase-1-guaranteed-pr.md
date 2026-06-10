# Run Contract Phase 1: Guaranteed PR — Implementation Plan

**Goal:** Every agent run that changed the working tree ends with a pushed branch and a pull request visible in issue detail — verified by the orchestrator, recovered via corrective turns, and finished mechanically when the agent fails.

**Architecture:** A new pure-ish module `SymphonyElixir.RunContract` inspects ground truth in the per-issue workspace (git state per repo + PR existence via `gh`). `AgentRunner` injects deliverable state into prompts and runs up to 2 corrective turns when the publish gate fails. `Orchestrator.apply_normal_completion` becomes conditional on the gate: violations trigger the mechanical `Finalizer` (push + `gh pr create`); if even that fails, the issue gets `symphony:blocked` + a workpad note and does NOT transition. Verified/created PR URLs are written deterministically into `tracker_pull_requests`.

**Tech Stack:** Elixir/OTP (ExUnit, `System.cmd` git/gh), SQLite via Ecto, React/TypeScript (vitest) for the UI banner.

**Spec:** `docs/superpowers/specs/2026-06-09-run-contract-design.md` (Phase 1 scope). Scope note: the PR body in this phase is generated from issue title/description (not the workpad) — workpad-derived bodies land with Phase 2, when the workpad itself is guaranteed.

**Working directory:** all `mix` commands run inside `elixir/`. Tests that create git repos use ExUnit's `@tag :tmp_dir`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `elixir/lib/symphony_elixir/run_contract.ex` | Create | Repo inspection (`repo_states/1`), publish-gate evaluation, deliverable summary text, `gh` PR checker |
| `elixir/lib/symphony_elixir/run_contract/finalizer.ex` | Create | Mechanical commit/branch/push/PR fallback |
| `elixir/lib/symphony_elixir/agent_runner.ex` | Modify | Deliverable state in prompts; corrective publish turns |
| `elixir/lib/symphony_elixir/orchestrator.ex` | Modify | Completion gated on contract; finalizer call; blocked label/comment; PR link persistence |
| `elixir/lib/symphony_elixir/tracker/sync/local_store.ex` | Modify | `upsert_run_pull_request/3` (origin `"agent"`) |
| `tracker/src/components/issues/issue-detail/BlockedBanner.tsx` | Create | Banner when issue has `symphony:blocked` |
| `tracker/src/components/issues/issue-detail/SummaryTab.tsx` | Modify | Render the banner |
| `.claude/skills/push/SKILL.md` | Modify | Upstream verification + Definition of done |
| `elixir/test/symphony_elixir/run_contract_test.exs` | Create | Gate + inspection tests |
| `elixir/test/symphony_elixir/run_contract/finalizer_test.exs` | Create | Finalizer tests (local bare remote + stubbed `gh`) |
| `tracker/src/components/issues/issue-detail/__tests__/BlockedBanner.test.tsx` | Create | Banner tests |

---

### Task 1: `RunContract.repo_states/1` — workspace git inspection

**Files:**
- Create: `elixir/lib/symphony_elixir/run_contract.ex`
- Test: `elixir/test/symphony_elixir/run_contract_test.exs`

- [ ] **Step 1: Write the failing tests**

```elixir
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
    git remote add origin #{origin} && git push -u origin main &&
    git remote set-head origin main
    """)
    repo
  end

  defp workspace!(tmp_dir) do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    ws
  end

  # --- tests ---------------------------------------------------------------

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

    assert %RepoState{branch: "docs/gam-3", upstream?: false, ahead_count: 1, dirty?: false, default_branch: "main"} = state
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/run_contract_test.exs`
Expected: compile error — `module SymphonyElixir.RunContract is not available`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.RunContract do
  @moduledoc """
  Deterministic deliverable checks for an issue run (publish gate).

  Inspects ground truth in the workspace: every git repo directly under the
  workspace root (or the workspace itself when it is a repo) is checked for
  committed-but-unpublished work and, via a pluggable checker, for a pull
  request on its current branch. A workspace with clean trees and no commits
  ahead of base satisfies the contract (no-op run).
  """

  require Logger

  defmodule RepoState do
    @moduledoc false
    @enforce_keys [:path, :name]
    defstruct [:path, :name, :branch, :default_branch, dirty?: false, upstream?: false, ahead_count: 0]

    @type t :: %__MODULE__{
            path: Path.t(),
            name: String.t(),
            branch: String.t() | nil,
            default_branch: String.t() | nil,
            dirty?: boolean(),
            upstream?: boolean(),
            ahead_count: non_neg_integer()
          }
  end

  @type violation :: %{repo: String.t(), kind: atom(), detail: String.t()}
  @type pr_checker :: (RepoState.t() -> {:ok, map()} | :none | {:error, term()})

  @spec repo_states(Path.t()) :: [RepoState.t()]
  def repo_states(workspace) when is_binary(workspace) do
    workspace |> repo_dirs() |> Enum.map(&inspect_repo/1)
  end

  @spec work_present?([RepoState.t()]) :: boolean()
  def work_present?(repo_states) do
    Enum.any?(repo_states, &(&1.dirty? or &1.ahead_count > 0))
  end

  defp repo_dirs(workspace) do
    cond do
      File.dir?(Path.join(workspace, ".git")) ->
        [workspace]

      File.dir?(workspace) ->
        workspace
        |> File.ls!()
        |> Enum.sort()
        |> Enum.map(&Path.join(workspace, &1))
        |> Enum.filter(&File.dir?(Path.join(&1, ".git")))

      true ->
        []
    end
  end

  defp inspect_repo(path) do
    branch = git_value(path, ["branch", "--show-current"])
    default_branch = default_branch(path)
    upstream? = match?({:ok, _}, git(path, ["rev-parse", "--abbrev-ref", "@{upstream}"]))

    %RepoState{
      path: path,
      name: Path.basename(path),
      branch: presence(branch),
      default_branch: default_branch,
      dirty?: git_value(path, ["status", "--porcelain"]) != "",
      upstream?: upstream?,
      ahead_count: ahead_count(path, presence(branch), default_branch, upstream?)
    }
  end

  defp ahead_count(path, branch, default_branch, upstream?) do
    cond do
      upstream? ->
        count(path, ["rev-list", "--count", "@{upstream}..HEAD"])

      is_binary(default_branch) and is_binary(branch) and branch != default_branch ->
        count(path, ["rev-list", "--count", "origin/#{default_branch}..HEAD"])

      true ->
        0
    end
  end

  defp default_branch(path) do
    case git(path, ["rev-parse", "--abbrev-ref", "origin/HEAD"]) do
      {:ok, "origin/" <> name} -> name
      _ -> nil
    end
  end

  defp git(path, args) do
    case System.cmd("git", args, cd: path, stderr_to_stdout: true) do
      {output, 0} -> {:ok, String.trim(output)}
      {output, status} -> {:error, {status, String.trim(output)}}
    end
  end

  defp git_value(path, args) do
    case git(path, args) do
      {:ok, value} -> value
      {:error, _reason} -> ""
    end
  end

  defp count(path, args) do
    with {:ok, value} <- git(path, args),
         {n, ""} <- Integer.parse(value) do
      n
    else
      _ -> 0
    end
  end

  defp presence(""), do: nil
  defp presence(value), do: value
end
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/run_contract_test.exs`
Expected: `5 tests, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/run_contract.ex elixir/test/symphony_elixir/run_contract_test.exs
git commit -m "feat(run-contract): inspect workspace git deliverable state"
```

---

### Task 2: Publish-gate evaluation + `gh` PR checker + summary text

**Files:**
- Modify: `elixir/lib/symphony_elixir/run_contract.ex`
- Test: `elixir/test/symphony_elixir/run_contract_test.exs`

- [ ] **Step 1: Write the failing tests** (append inside the existing module)

```elixir
  describe "evaluate_publish/2" do
    defp repo_state(attrs) do
      struct!(RepoState, Map.merge(%{path: "/tmp/x", name: "frontend", branch: "feat/x", default_branch: "main"}, attrs))
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
    test "parses gh pr list output and skips closed PRs" do
      open = fn "gh", _args, _opts -> {~s([{"url":"https://x/pull/1","state":"OPEN","number":1,"title":"t"}]), 0} end
      closed = fn "gh", _args, _opts -> {~s([{"url":"https://x/pull/1","state":"CLOSED","number":1,"title":"t"}]), 0} end
      empty = fn "gh", _args, _opts -> {"[]", 0} end
      failing = fn "gh", _args, _opts -> {"gh: auth error", 1} end
      repo = struct!(RepoState, %{path: "/tmp", name: "r", branch: "feat/x"})

      assert {:ok, %{url: "https://x/pull/1"}} = RunContract.gh_pr_checker(runner: open).(repo)
      assert :none = RunContract.gh_pr_checker(runner: closed).(repo)
      assert :none = RunContract.gh_pr_checker(runner: empty).(repo)
      assert {:error, _reason} = RunContract.gh_pr_checker(runner: failing).(repo)
    end
  end

  describe "summary_text/1" do
    test "renders one line per repo" do
      states = [struct!(RepoState, %{path: "/a", name: "frontend", branch: "feat/x", ahead_count: 3, upstream?: false, dirty?: true})]
      text = RunContract.summary_text(states)
      assert text =~ "frontend"
      assert text =~ "commits_ahead=3"
      assert text =~ "pushed=no"
      assert text =~ "uncommitted=yes"
    end
  end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/run_contract_test.exs`
Expected: FAIL — `evaluate_publish/2 is undefined`

- [ ] **Step 3: Implement** (append to `SymphonyElixir.RunContract`)

```elixir
  @spec evaluate_publish([RepoState.t()], pr_checker()) :: :satisfied | {:violations, [violation()]}
  def evaluate_publish(repo_states, pr_checker) when is_function(pr_checker, 1) do
    case Enum.flat_map(repo_states, &repo_violations(&1, pr_checker)) do
      [] -> :satisfied
      violations -> {:violations, violations}
    end
  end

  @spec pull_requests([RepoState.t()], pr_checker()) :: [map()]
  def pull_requests(repo_states, pr_checker) when is_function(pr_checker, 1) do
    repo_states
    |> Enum.filter(&(&1.ahead_count > 0 and &1.upstream?))
    |> Enum.flat_map(fn repo ->
      case pr_checker.(repo) do
        {:ok, pr} -> [Map.put(pr, :repo, repo.name)]
        _other -> []
      end
    end)
  end

  @spec summary_text([RepoState.t()]) :: String.t()
  def summary_text([]), do: "No git repositories found in the workspace."

  def summary_text(repo_states) do
    Enum.map_join(repo_states, "\n", fn repo ->
      "- #{repo.name}: branch=#{repo.branch || "?"} commits_ahead=#{repo.ahead_count}" <>
        " uncommitted=#{yes_no(repo.dirty?)} pushed=#{yes_no(repo.upstream?)}"
    end)
  end

  @doc """
  Default PR checker backed by the `gh` CLI, querying by head branch in the
  repo's own directory so it works for any GitHub repo regardless of the
  project's tracker kind. Closed PRs do not satisfy the gate; merged ones do.
  """
  @spec gh_pr_checker(keyword()) :: pr_checker()
  def gh_pr_checker(opts \\ []) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    fn %RepoState{} = repo ->
      args = ["pr", "list", "--head", repo.branch || "", "--state", "all", "--json", "url,state,number,title", "--limit", "1"]

      case runner.("gh", args, cd: repo.path, stderr_to_stdout: true) do
        {output, 0} -> decode_pr_list(output)
        {output, status} -> {:error, {status, String.trim(output)}}
      end
    end
  end

  defp repo_violations(%RepoState{dirty?: true} = repo, _pr_checker) do
    [%{repo: repo.name, kind: :uncommitted_changes, detail: "working tree has uncommitted changes"}]
  end

  defp repo_violations(%RepoState{ahead_count: 0}, _pr_checker), do: []

  defp repo_violations(%RepoState{upstream?: false} = repo, _pr_checker) do
    [%{repo: repo.name, kind: :unpublished_branch, detail: "branch #{repo.branch} has #{repo.ahead_count} commit(s) without an upstream"}]
  end

  defp repo_violations(%RepoState{} = repo, pr_checker) do
    case pr_checker.(repo) do
      {:ok, %{url: url}} when is_binary(url) ->
        []

      :none ->
        [%{repo: repo.name, kind: :missing_pull_request, detail: "branch #{repo.branch} is pushed but has no pull request"}]

      {:error, reason} ->
        [%{repo: repo.name, kind: :pr_check_failed, detail: "could not verify pull request: #{inspect(reason)}"}]
    end
  end

  defp decode_pr_list(output) do
    case Jason.decode(String.trim(output)) do
      {:ok, [%{"url" => url, "state" => state} = pr | _rest]} when state != "CLOSED" ->
        {:ok, %{url: url, state: state, number: pr["number"], title: pr["title"]}}

      {:ok, _closed_or_empty} ->
        :none

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp yes_no(true), do: "yes"
  defp yes_no(false), do: "no"
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/run_contract_test.exs`
Expected: `15 tests, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/run_contract.ex elixir/test/symphony_elixir/run_contract_test.exs
git commit -m "feat(run-contract): publish gate evaluation and gh PR checker"
```

---

### Task 3: Deliverable state in AgentRunner prompts

Fixes the GAM-5 restart problem: re-dispatched and continuation turns tell the agent exactly what already exists instead of restarting from scratch.

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` (functions `build_turn_prompt/5`, around lines 265–279)
- Test: `elixir/test/symphony_elixir/agent_runner_test.exs` (append; follow existing patterns in that file)

- [ ] **Step 1: Write the failing tests**

`AgentRunner.build_turn_prompt/5` is private. Expose the prompt pieces as `@doc false` public functions for testability (mirrors `claude_session_opts/3` precedent in the same module):

```elixir
defmodule SymphonyElixir.AgentRunnerPromptTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.RunContract.RepoState

  defp states_with_work do
    [struct!(RepoState, %{path: "/w/frontend", name: "frontend", branch: "docs/gam-3", ahead_count: 3, upstream?: false})]
  end

  test "resume_section lists prior work and forbids restart" do
    text = AgentRunner.resume_section(states_with_work())
    assert text =~ "Resume notice"
    assert text =~ "docs/gam-3"
    assert text =~ "Do NOT restart from scratch"
  end

  test "continuation_prompt embeds deliverable state" do
    text = AgentRunner.continuation_prompt(2, 20, states_with_work())
    assert text =~ "continuation turn #2 of 20"
    assert text =~ "commits_ahead=3"
    assert text =~ "pull request"
  end
end
```

Save as `elixir/test/symphony_elixir/agent_runner_prompt_test.exs`.

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_prompt_test.exs`
Expected: FAIL — `resume_section/1 is undefined or private`

- [ ] **Step 3: Implement**

In `elixir/lib/symphony_elixir/agent_runner.ex`, add `RunContract` to the alias list, then replace the two `build_turn_prompt` clauses:

```elixir
  defp build_turn_prompt(issue, opts, workspace, 1, _max_turns) do
    base = PromptBuilder.build_prompt(issue, Keyword.put(opts, :workspace, workspace))
    repo_states = RunContract.repo_states(workspace)

    if RunContract.work_present?(repo_states) do
      base <> "\n\n" <> resume_section(repo_states)
    else
      base
    end
  end

  defp build_turn_prompt(_issue, _opts, workspace, turn_number, max_turns) do
    continuation_prompt(turn_number, max_turns, RunContract.repo_states(workspace))
  end

  @doc false
  @spec resume_section([RunContract.RepoState.t()]) :: String.t()
  def resume_section(repo_states) do
    """
    ## Resume notice (Symphony)

    A previous run already worked in this workspace. Current deliverable state:

    #{RunContract.summary_text(repo_states)}

    Do NOT restart from scratch. Review the existing work, finish what is missing,
    and ensure every repo with commits ends with a pushed branch and an open pull
    request (follow the `push` skill).
    """
  end

  @doc false
  @spec continuation_prompt(pos_integer(), pos_integer(), [RunContract.RepoState.t()]) :: String.t()
  def continuation_prompt(turn_number, max_turns, repo_states) do
    """
    Continuation guidance:

    - The previous turn completed normally, but the issue is still in an active state.
    - This is continuation turn ##{turn_number} of #{max_turns} for the current agent run.
    - Resume from the current workspace and workpad state instead of restarting from scratch.
    - The original task instructions and prior turn context are already present in this thread, so do not restate them before acting.
    - Focus on the remaining ticket work and do not end the turn while the issue stays active unless you are truly blocked.

    Deliverable state (computed by the orchestrator from the workspace):

    #{RunContract.summary_text(repo_states)}

    Any repo with commits ahead must end with a pushed branch and an open pull request (follow the `push` skill).
    """
  end
```

- [ ] **Step 4: Run to verify pass (new + existing runner tests)**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_prompt_test.exs test/symphony_elixir/agent_runner_test.exs`
Expected: `0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir/agent_runner_prompt_test.exs
git commit -m "feat(agent-runner): inject deliverable state into resume and continuation prompts"
```

---

### Task 4: Corrective publish turns in AgentRunner

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent_runner.ex` (`run_codex_turns/4`, around line 146)
- Test: `elixir/test/symphony_elixir/agent_runner_publish_gate_test.exs`

Design: after the turn loop returns `:completed` or `{:incomplete, :max_turns}` (session still open), evaluate the publish gate. On violation, run up to `@max_corrective_turns 2` extra turns with a surgical prompt, re-evaluating after each. If still violated, return `{:incomplete, {:publish_gate, violations}}` so the orchestrator triggers the finalizer. `{:error, _}` results pass through untouched. The gate evaluation and PR checker are injectable via `opts` (`:publish_gate_evaluator`, defaulting to `&RunContract.evaluate_publish/2` over fresh `repo_states`) so tests don't need real git/gh.

- [ ] **Step 1: Write the failing test**

The existing `agent_runner_test.exs` shows how `AgentRunner.run/3` is driven with fake sessions; follow its fixtures. The focused unit test targets the new loop via a `@doc false` function:

```elixir
defmodule SymphonyElixir.AgentRunnerPublishGateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentRunner

  test "satisfied gate returns original result without corrective turns" do
    evaluator = fn _workspace -> :satisfied end
    run_turn = fn _prompt -> raise "must not run corrective turn" end

    assert :completed = AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "violation triggers corrective turns until satisfied" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    evaluator = fn _workspace ->
      case Agent.get_and_update(agent, fn n -> {n, n + 1} end) do
        0 -> {:violations, [%{repo: "frontend", kind: :unpublished_branch, detail: "no upstream"}]}
        _ -> :satisfied
      end
    end

    run_turn = fn prompt ->
      assert prompt =~ "Publish gate failed"
      assert prompt =~ "no upstream"
      :ok
    end

    assert :completed = AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "exhausted corrective turns return publish_gate incomplete" do
    violations = [%{repo: "frontend", kind: :missing_pull_request, detail: "no PR"}]
    evaluator = fn _workspace -> {:violations, violations} end
    run_turn = fn _prompt -> :ok end

    assert {:incomplete, {:publish_gate, ^violations}} =
             AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "failed corrective turn stops early with publish_gate incomplete" do
    violations = [%{repo: "frontend", kind: :missing_pull_request, detail: "no PR"}]
    evaluator = fn _workspace -> {:violations, violations} end
    run_turn = fn _prompt -> {:error, :turn_failed} end

    assert {:incomplete, {:publish_gate, ^violations}} =
             AgentRunner.apply_publish_gate(:completed, "/tmp/ws", evaluator, run_turn, 2)
  end

  test "errors pass through" do
    evaluator = fn _workspace -> raise "must not evaluate" end
    assert {:error, :boom} = AgentRunner.apply_publish_gate({:error, :boom}, "/tmp/ws", evaluator, fn _ -> :ok end, 2)
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_publish_gate_test.exs`
Expected: FAIL — `apply_publish_gate/5 is undefined`

- [ ] **Step 3: Implement**

Add to `AgentRunner` (module attribute near the top: `@max_corrective_turns 2`):

```elixir
  @doc false
  @spec apply_publish_gate(term(), Path.t(), (Path.t() -> :satisfied | {:violations, list()}), (String.t() -> :ok | {:error, term()}), non_neg_integer()) :: term()
  def apply_publish_gate({:error, _reason} = error, _workspace, _evaluator, _run_turn, _budget), do: error

  def apply_publish_gate(result, workspace, evaluator, run_turn, budget) do
    case evaluator.(workspace) do
      :satisfied ->
        result

      {:violations, violations} when budget > 0 ->
        case run_turn.(corrective_publish_prompt(violations, workspace)) do
          :ok -> apply_publish_gate(result, workspace, evaluator, run_turn, budget - 1)
          {:error, _reason} -> {:incomplete, {:publish_gate, violations}}
        end

      {:violations, violations} ->
        {:incomplete, {:publish_gate, violations}}
    end
  end

  defp corrective_publish_prompt(violations, workspace) do
    """
    ## Publish gate failed (Symphony)

    The run cannot finish because the following deliverables are missing:

    #{Enum.map_join(violations, "\n", fn v -> "- #{v.repo}: #{v.detail}" end)}

    Current deliverable state:

    #{RunContract.summary_text(RunContract.repo_states(workspace))}

    Follow the `push` skill now: commit any intentional pending changes, push each
    branch with upstream tracking, and open a pull request for every repo with
    commits. Do nothing else in this turn.
    """
  end
```

Wire it into `run_codex_turns/4` — change the `with` body so the gate runs while the session is still open:

```elixir
    with {:ok, session} <- CodingAgent.start_session(workspace, agent_kind, session_opts) do
      try do
        result =
          do_run_codex_turns(
            session, workspace, issue, codex_update_recipient,
            opts, issue_state_fetcher, agent_kind, 1, max_turns
          )

        evaluator =
          Keyword.get(opts, :publish_gate_evaluator, fn ws ->
            RunContract.evaluate_publish(RunContract.repo_states(ws), RunContract.gh_pr_checker())
          end)

        run_corrective_turn = fn prompt ->
          case CodingAgent.run_turn(session, prompt, issue, agent_turn_opts(opts, agent_kind, codex_update_recipient, issue)) do
            {:ok, _turn_session} -> :ok
            {:error, reason} -> {:error, reason}
          end
        end

        apply_publish_gate(result, workspace, evaluator, run_corrective_turn, @max_corrective_turns)
      after
        CodingAgent.stop_session(session, agent_kind)
      end
    end
```

- [ ] **Step 4: Run to verify pass + no regressions**

Run: `cd elixir && mix test test/symphony_elixir/agent_runner_publish_gate_test.exs test/symphony_elixir/agent_runner_test.exs test/symphony_elixir/agent_runner_agent_kind_test.exs`
Expected: `0 failures`. Note: existing `run/3` tests that drive full runs may now hit the gate; their fixtures use workspaces without git repos, which evaluate to `:satisfied` (no work), so they pass unchanged. If any test uses a git workspace fixture with commits, pass `publish_gate_evaluator: fn _ -> :satisfied end` in its opts.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/agent_runner.ex elixir/test/symphony_elixir/agent_runner_publish_gate_test.exs
git commit -m "feat(agent-runner): corrective turns when publish gate is violated"
```

---

### Task 5: Mechanical `Finalizer` (push + PR fallback)

**Files:**
- Create: `elixir/lib/symphony_elixir/run_contract/finalizer.ex`
- Test: `elixir/test/symphony_elixir/run_contract/finalizer_test.exs`

Behavior per repo with work (`dirty?` or `ahead_count > 0`):
1. Dirty tree → `git add -A` + `git commit -m "chore(<identifier>): commit remaining work from agent run"`.
2. On the default branch with commits ahead → create branch `symphony/<identifier-downcased>` first (never push to the default branch).
3. `git push -u origin HEAD`.
4. PR exists for head branch (via checker)? Reuse it. Else `gh pr create --base <default> --title ... --body-file ...`, then `gh pr view --json url,number,state,title`.

All `git`/`gh` calls go through an injectable `runner` (default `&System.cmd/3`). Tests use real git against a local bare remote and a runner wrapper that stubs only `gh`. First failure halts and returns `{:error, {repo_name, reason}}`.

- [ ] **Step 1: Write the failing tests**

```elixir
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
    git remote add origin #{origin} && git push -u origin main &&
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/run_contract/finalizer_test.exs`
Expected: compile error — `SymphonyElixir.RunContract.Finalizer is not available`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.RunContract.Finalizer do
  @moduledoc """
  Mechanical fallback for the publish gate: commits leftover work, publishes
  branches, and opens pull requests when the agent could not. Invoked by the
  orchestrator only after corrective turns were exhausted. Never pushes to the
  repo's default branch — work found there is moved to `symphony/<identifier>`.
  """

  require Logger
  alias SymphonyElixir.Issue
  alias SymphonyElixir.RunContract
  alias SymphonyElixir.RunContract.RepoState

  @type pr :: %{repo: String.t(), url: String.t(), number: integer() | nil, state: String.t() | nil, title: String.t() | nil}

  @spec finalize(Path.t(), Issue.t(), keyword()) :: {:ok, [pr()]} | {:error, {String.t(), term()}}
  def finalize(workspace, %Issue{} = issue, opts \\ []) do
    runner = Keyword.get(opts, :runner, &System.cmd/3)

    workspace
    |> RunContract.repo_states()
    |> Enum.filter(&(&1.dirty? or &1.ahead_count > 0))
    |> Enum.reduce_while({:ok, []}, fn repo, {:ok, acc} ->
      case finalize_repo(repo, issue, runner) do
        {:ok, pr} -> {:cont, {:ok, [pr | acc]}}
        {:error, reason} -> {:halt, {:error, {repo.name, reason}}}
      end
    end)
    |> case do
      {:ok, prs} -> {:ok, Enum.reverse(prs)}
      error -> error
    end
  end

  defp finalize_repo(%RepoState{} = repo, issue, runner) do
    Logger.warning("Finalizer publishing repo=#{repo.name} branch=#{repo.branch} issue_identifier=#{issue.identifier}")

    with :ok <- maybe_commit_dirty(repo, issue, runner),
         :ok <- maybe_branch_off_default(repo, issue, runner),
         :ok <- push(repo, runner),
         {:ok, pr} <- ensure_pull_request(repo, issue, runner) do
      {:ok, Map.put(pr, :repo, repo.name)}
    end
  end

  defp maybe_commit_dirty(%RepoState{dirty?: false}, _issue, _runner), do: :ok

  defp maybe_commit_dirty(%RepoState{path: path}, issue, runner) do
    with :ok <- run(runner, "git", ["add", "-A"], path) do
      run(runner, "git", ["commit", "-m", "chore(#{issue.identifier}): commit remaining work from agent run"], path)
    end
  end

  defp maybe_branch_off_default(%RepoState{branch: branch, default_branch: default} = repo, issue, runner)
       when is_binary(branch) and branch == default do
    run(runner, "git", ["checkout", "-b", "symphony/#{String.downcase(issue.identifier)}"], repo.path)
  end

  defp maybe_branch_off_default(_repo, _issue, _runner), do: :ok

  defp push(%RepoState{path: path}, runner) do
    run(runner, "git", ["push", "-u", "origin", "HEAD"], path)
  end

  defp ensure_pull_request(%RepoState{path: path} = repo, issue, runner) do
    checker = RunContract.gh_pr_checker(runner: runner)

    case checker.(current_branch_state(repo, runner)) do
      {:ok, pr} ->
        {:ok, pr}

      :none ->
        create_pull_request(path, repo, issue, runner)

      {:error, reason} ->
        {:error, {:pr_check_failed, reason}}
    end
  end

  defp create_pull_request(path, repo, issue, runner) do
    body_file = Path.join(System.tmp_dir!(), "symphony-pr-body-#{System.unique_integer([:positive])}.md")
    File.write!(body_file, pr_body(issue))

    base_args = if is_binary(repo.default_branch), do: ["--base", repo.default_branch], else: []

    try do
      with :ok <- run(runner, "gh", ["pr", "create", "--title", pr_title(issue), "--body-file", body_file] ++ base_args, path) do
        view_pull_request(path, runner)
      end
    after
      File.rm(body_file)
    end
  end

  defp view_pull_request(path, runner) do
    case runner.("gh", ["pr", "view", "--json", "url,number,state,title"], cd: path, stderr_to_stdout: true) do
      {output, 0} ->
        case Jason.decode(String.trim(output)) do
          {:ok, %{"url" => url} = pr} -> {:ok, %{url: url, number: pr["number"], state: pr["state"], title: pr["title"]}}
          {:error, reason} -> {:error, {:pr_view_decode_failed, reason}}
        end

      {output, status} ->
        {:error, {:pr_view_failed, status, String.trim(output)}}
    end
  end

  # Re-read branch name after a possible checkout -b so the PR lookup targets
  # the branch actually being pushed.
  defp current_branch_state(%RepoState{path: path} = repo, runner) do
    case runner.("git", ["branch", "--show-current"], cd: path, stderr_to_stdout: true) do
      {output, 0} -> %{repo | branch: String.trim(output)}
      _failure -> repo
    end
  end

  defp pr_title(%Issue{identifier: identifier, title: title}), do: "#{identifier}: #{title}"

  defp pr_body(%Issue{} = issue) do
    description =
      case Map.get(issue, :description) do
        text when is_binary(text) and text != "" -> String.slice(text, 0, 4_000)
        _missing -> "(no issue description)"
      end

    """
    ## Summary

    Automated publish for **#{issue.identifier}: #{issue.title}**.

    #{description}

    > ⚠️ Symphony run-contract finalizer: the agent completed work in this
    > workspace but did not publish it. Symphony pushed the branch and opened
    > this PR mechanically. Review with extra care.
    """
  end

  defp run(runner, cmd, args, path) do
    case runner.(cmd, args, cd: path, stderr_to_stdout: true) do
      {_output, 0} -> :ok
      {output, status} -> {:error, {cmd, args, status, String.trim(output)}}
    end
  end
end
```

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/run_contract/finalizer_test.exs`
Expected: `5 tests, 0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/run_contract/finalizer.ex elixir/test/symphony_elixir/run_contract/finalizer_test.exs
git commit -m "feat(run-contract): mechanical finalizer pushes work and opens PRs"
```

---

### Task 6: `LocalStore.upsert_run_pull_request/3`

**Files:**
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex` (next to `link_manual_pull_request/3`, line ~194)
- Test: `elixir/test/symphony_elixir/tracker/sync/local_store_test.exs` (append; reuse that file's existing project/issue fixtures)

- [ ] **Step 1: Write the failing test** (append to the existing local_store test module, using its fixture helpers for creating a project; adapt names to the helpers present in the file)

```elixir
  describe "upsert_run_pull_request/3" do
    test "links a PR with origin agent keyed by URL", %{project: project} do
      url = "https://github.com/o/r/pull/42"

      assert {:ok, record} =
               LocalStore.upsert_run_pull_request(project.id, "GAM-9", %{
                 url: url,
                 repo: "o/r",
                 number: 42,
                 title: "GAM-9: Do the thing",
                 state: "OPEN"
               })

      assert record.origin == "agent"
      assert record.remote_id == url

      # Idempotent on the same URL
      assert {:ok, again} = LocalStore.upsert_run_pull_request(project.id, "GAM-9", %{url: url, state: "OPEN"})
      assert again.id == record.id
    end
  end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_store_test.exs`
Expected: FAIL — `upsert_run_pull_request/3 is undefined`

- [ ] **Step 3: Implement**

Add below `link_manual_pull_request/3`, reusing its URL-keyed upsert shape:

```elixir
  @doc """
  Links a pull request verified or created by the orchestrator's run contract
  (publish gate / finalizer). Keyed by URL like manual links so the association
  is deterministic and survives GitHub discovery gaps (e.g. non-numeric tracker
  identifiers such as GAM-5). Origin `"agent"` distinguishes it in the UI.
  """
  @spec upsert_run_pull_request(integer(), String.t(), %{required(:url) => String.t(), optional(atom()) => term()}) ::
          {:ok, PullRequestRecord.t()} | {:error, term()}
  def upsert_run_pull_request(project_id, identifier, %{url: url} = attrs)
      when is_integer(project_id) and is_binary(url) do
    identifier = normalize_identifier(identifier)

    base = %{
      project_id: project_id,
      issue_identifier: identifier,
      remote_id: url,
      url: url,
      number: Map.get(attrs, :number),
      repo: Map.get(attrs, :repo),
      title: Map.get(attrs, :title) || manual_title(Map.get(attrs, :number)),
      state: Map.get(attrs, :state) || "unknown",
      origin: "agent",
      last_synced_at: DateTime.utc_now()
    }

    case Repo.get_by(PullRequestRecord,
           project_id: project_id,
           issue_identifier: identifier,
           remote_id: url
         ) do
      nil -> %PullRequestRecord{}
      %PullRequestRecord{} = existing -> existing
    end
    |> PullRequestRecord.changeset(base)
    |> Repo.insert_or_update()
  end
```

Note: if `PullRequestRecord.changeset/2` validates `origin` against an allowed list, add `"agent"` to that list in `elixir/lib/symphony_elixir/tracker/sync/pull_request_record.ex` (check the schema file; the test will catch it).

- [ ] **Step 4: Run to verify pass**

Run: `cd elixir && mix test test/symphony_elixir/tracker/sync/local_store_test.exs`
Expected: `0 failures`

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/tracker/sync/local_store.ex elixir/test/symphony_elixir/tracker/sync/local_store_test.exs
git commit -m "feat(tracker): persist run-contract PR links with agent origin"
```

---

### Task 7: Orchestrator completion gate + blocked handling

**Files:**
- Modify: `elixir/lib/symphony_elixir/orchestrator.ex` (`apply_normal_completion/3` at line ~785; new helpers near `maybe_annotate_incomplete/2` ~line 892)
- Test: `elixir/test/symphony_elixir/orchestrator_run_contract_test.exs`

Design: `apply_normal_completion/3` first ensures the publish contract. The contract function is injectable via the orchestrator state/opts for tests (`:publish_contract_fn`, default implementation below). Outcomes:

- `{:ok, prs}` → persist PR links, then the existing annotate-incomplete + transition flow.
- `{:blocked, violations}` → post blocked workpad note + `symphony:blocked` label, do **not** transition, `complete_issue` (free the slot), do **not** schedule a retry (a human must intervene; re-dispatch happens when they move the issue).

- [ ] **Step 1: Write the failing tests**

Follow the construction pattern used by existing orchestrator tests (`elixir/test/symphony_elixir/orchestrator_test.exs`) for starting the GenServer with injected fns. The focused tests target the new pure helpers:

```elixir
defmodule SymphonyElixir.OrchestratorRunContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator

  test "blocked_comment_body lists violations and explains no transition" do
    body =
      Orchestrator.blocked_comment_body([
        %{repo: "frontend", kind: :unpublished_branch, detail: "branch docs/gam-3 has 3 commit(s) without an upstream"}
      ])

    assert body =~ "## Codex Workpad"
    assert body =~ "blocked"
    assert body =~ "frontend: branch docs/gam-3"
    assert body =~ "NOT moved to review"
  end

  test "default_publish_contract returns ok with prs for satisfied gate" do
    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker -> :satisfied end,
      pull_requests: fn _states, _checker -> [%{repo: "frontend", url: "https://x/pull/1"}] end,
      finalize: fn _workspace, _issue -> raise "must not finalize" end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:ok, [%{url: "https://x/pull/1"}]} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end

  test "violations route to finalizer; finalizer success returns its prs" do
    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker -> {:violations, [%{repo: "frontend", kind: :missing_pull_request, detail: "no PR"}]} end,
      pull_requests: fn _states, _checker -> [] end,
      finalize: fn _workspace, _issue -> {:ok, [%{repo: "frontend", url: "https://x/pull/2"}]} end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:ok, [%{url: "https://x/pull/2"}]} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end

  test "finalizer failure blocks with violations" do
    violations = [%{repo: "frontend", kind: :unpublished_branch, detail: "no upstream"}]

    deps = %{
      repo_states: fn _workspace -> [] end,
      evaluate: fn _states, _checker -> {:violations, violations} end,
      pull_requests: fn _states, _checker -> [] end,
      finalize: fn _workspace, _issue -> {:error, {"frontend", :push_failed}} end,
      pr_checker: fn _repo -> :none end
    }

    issue = %SymphonyElixir.Issue{id: "uuid", identifier: "GAM-9", state: "In Progress"}
    assert {:blocked, ^violations, {"frontend", :push_failed}} = Orchestrator.run_publish_contract(issue, "/tmp/ws", deps)
  end
end
```

- [ ] **Step 2: Run to verify failure**

Run: `cd elixir && mix test test/symphony_elixir/orchestrator_run_contract_test.exs`
Expected: FAIL — `blocked_comment_body/1 is undefined`

- [ ] **Step 3: Implement**

Add to `Orchestrator` (aliases: `SymphonyElixir.RunContract`, `SymphonyElixir.RunContract.Finalizer`; attribute `@blocked_run_label "symphony:blocked"` next to `@incomplete_run_label`):

```elixir
  @doc false
  @spec run_publish_contract(Issue.t(), Path.t(), map()) ::
          {:ok, [map()]} | {:blocked, [map()], term()}
  def run_publish_contract(%Issue{} = issue, workspace, deps) do
    repo_states = deps.repo_states.(workspace)

    case deps.evaluate.(repo_states, deps.pr_checker) do
      :satisfied ->
        {:ok, deps.pull_requests.(repo_states, deps.pr_checker)}

      {:violations, violations} ->
        Logger.warning("Publish contract violated for issue_id=#{issue.id} issue_identifier=#{issue.identifier} violations=#{inspect(violations)}; invoking finalizer")

        case deps.finalize.(workspace, issue) do
          {:ok, prs} -> {:ok, prs}
          {:error, reason} -> {:blocked, violations, reason}
        end
    end
  end

  @doc false
  @spec default_publish_contract_deps() :: map()
  def default_publish_contract_deps do
    %{
      repo_states: &RunContract.repo_states/1,
      evaluate: &RunContract.evaluate_publish/2,
      pull_requests: &RunContract.pull_requests/2,
      finalize: &Finalizer.finalize/2,
      pr_checker: RunContract.gh_pr_checker()
    }
  end

  @doc false
  @spec blocked_comment_body([map()]) :: String.t()
  def blocked_comment_body(violations) do
    """
    ## Codex Workpad

    > 🛑 Symphony auto-note: this run is **blocked** — the publish gate could not be
    > satisfied even after corrective turns and the mechanical finalizer.
    >
    #{Enum.map_join(violations, "\n", fn v -> "> - #{v.repo}: #{v.detail}" end)}
    >
    > The issue was NOT moved to review. Fix the underlying problem (auth, remote,
    > branch state), then move the issue back to an active state to re-dispatch.
    """
  end
```

Rework `apply_normal_completion/3`:

```elixir
  defp apply_normal_completion(%State{} = state, running_entry, issue_id) do
    issue = running_entry.issue
    workspace = Workspace.path_for_issue(issue)
    deps = Map.get(state.opts, :publish_contract_deps, default_publish_contract_deps())

    case run_publish_contract(issue, workspace, deps) do
      {:ok, prs} ->
        record_run_pull_requests(issue, prs)
        maybe_annotate_incomplete(running_entry, issue_id)
        apply_transition_after_contract(state, running_entry, issue_id)

      {:blocked, violations, reason} ->
        Logger.warning("Run blocked for issue_id=#{issue_id} issue_identifier=#{issue.identifier} reason=#{inspect(reason)}; skipping completion transition")

        annotate_blocked(running_entry, issue_id, violations)
        complete_issue(state, issue_id)
    end
  end

  # Existing transition flow, extracted verbatim from the old apply_normal_completion body.
  defp apply_transition_after_contract(%State{} = state, running_entry, issue_id) do
    case apply_completion_transition(state, issue_id, running_entry.issue) do
      {:transitioned, transitioned_state} ->
        transitioned_state

      result when result in [:not_configured, :not_visible] ->
        state
        |> complete_issue(issue_id)
        |> schedule_issue_retry(issue_id, 1, %{
          identifier: running_entry.identifier,
          project_slug: running_entry.issue.project_slug,
          delay_type: :continuation
        })

      {:error, reason} ->
        schedule_issue_retry(state, issue_id, next_retry_attempt_from_running(running_entry), %{
          identifier: running_entry.identifier,
          project_slug: running_entry.issue.project_slug,
          error: "completion transition failed: #{inspect(reason)}"
        })
    end
  end

  defp record_run_pull_requests(%Issue{project_slug: slug, identifier: identifier}, prs)
       when is_binary(slug) and slug != "" and is_list(prs) and prs != [] do
    case Context.get_project(slug) do
      {:ok, project} ->
        Enum.each(prs, fn pr ->
          case SymphonyElixir.Tracker.Sync.LocalStore.upsert_run_pull_request(project.id, identifier, pr) do
            {:ok, _record} -> :ok
            {:error, error} -> Logger.warning("Failed to persist run PR link issue=#{identifier} url=#{pr[:url]}: #{inspect(error)}")
          end
        end)

      {:error, error} ->
        Logger.warning("Cannot persist run PR links issue=#{identifier}: project lookup failed #{inspect(error)}")
    end
  end

  defp record_run_pull_requests(_issue, _prs), do: :ok

  defp annotate_blocked(running_entry, issue_id, violations) do
    case Tracker.create_comment(issue_id, blocked_comment_body(violations)) do
      :ok -> :ok
      {:error, error} -> Logger.warning("Failed to post blocked comment issue_id=#{issue_id}: #{inspect(error)}")
    end

    add_label(running_entry, @blocked_run_label)
  end

  # Generalized from add_incomplete_label/1; replace that function's body with
  # `add_label(running_entry, @incomplete_run_label)` to avoid duplication.
  defp add_label(%{issue: %Issue{identifier: identifier, project_slug: slug}}, label)
       when is_binary(identifier) and is_binary(slug) and slug != "" do
    case Context.add_issue_label(slug, identifier, label) do
      {:ok, _issue} ->
        :ok

      {:error, error} ->
        Logger.warning("Failed to add label #{label} issue=#{identifier} project=#{slug}: #{inspect(error)}")
        :ok
    end
  end

  defp add_label(_running_entry, _label), do: :ok
```

Notes for the implementer:
- The orchestrator `State` — check how injected options are stored (the struct near the top of the file). If there is no `opts` map on `%State{}`, add `publish_contract_deps` as a struct field defaulting to `nil` and fall back to `default_publish_contract_deps()` when `nil`. Existing tests construct state via `init/1`; thread the new option through `init` the same way other injectable fns (e.g. issue fetchers) are threaded.
- `{:incomplete, {:publish_gate, violations}}` outcomes flow through the *existing* `maybe_annotate_incomplete/2`; extend `incomplete_reason_text/1` with:

```elixir
  defp incomplete_reason_text({:publish_gate, _violations}), do: "ended with the publish gate unsatisfied (deliverables missing)"
```

- [ ] **Step 4: Run to verify pass + orchestrator regression suite**

Run: `cd elixir && mix test test/symphony_elixir/orchestrator_run_contract_test.exs test/symphony_elixir/orchestrator_test.exs`
Expected: `0 failures`. Existing orchestrator completion tests use workspaces without git work → contract evaluates `:satisfied` with `prs: []` → behavior unchanged. If any fixture lacks a real workspace dir, `RunContract.repo_states/1` returns `[]` (satisfied), so the old flow holds; alternatively inject `publish_contract_deps` returning `{:ok, []}` in those tests.

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/orchestrator.ex elixir/test/symphony_elixir/orchestrator_run_contract_test.exs
git commit -m "feat(orchestrator): gate completion transitions on the publish contract"
```

---

### Task 8: `symphony:blocked` banner in issue detail

**Files:**
- Create: `tracker/src/components/issues/issue-detail/BlockedBanner.tsx`
- Modify: `tracker/src/components/issues/issue-detail/SummaryTab.tsx`
- Test: `tracker/src/components/issues/issue-detail/__tests__/BlockedBanner.test.tsx`

- [ ] **Step 1: Write the failing test** (follow the render/setup idioms of the existing tests in the same `__tests__` folder — they use vitest + testing-library)

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BlockedBanner } from "../BlockedBanner";

describe("BlockedBanner", () => {
  it("renders an alert when the issue has the symphony:blocked label", () => {
    render(<BlockedBanner labels={["bug", "symphony:blocked"]} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Run blocked");
    expect(alert.textContent).toContain("publish gate");
  });

  it("renders nothing without the label", () => {
    const { container } = render(<BlockedBanner labels={["bug"]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__/BlockedBanner.test.tsx`
Expected: FAIL — cannot resolve `../BlockedBanner`

- [ ] **Step 3: Implement**

`tracker/src/components/issues/issue-detail/BlockedBanner.tsx`:

```tsx
import { OctagonAlert } from "lucide-react";

const BLOCKED_LABEL = "symphony:blocked";

interface BlockedBannerProps {
  labels: string[] | undefined;
}

export function BlockedBanner({ labels }: BlockedBannerProps) {
  if (!labels?.includes(BLOCKED_LABEL)) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">Run blocked — publish gate unsatisfied</p>
        <p className="mt-0.5">
          The agent run finished with work that could not be published (push or pull
          request failed even after Symphony&apos;s finalizer). See the latest workpad
          note for the exact violation, fix the underlying problem, and move the issue
          back to an active state to re-dispatch.
        </p>
      </div>
    </div>
  );
}
```

In `SummaryTab.tsx`, import and render as the first child of the component's root container in the returned JSX:

```tsx
import { BlockedBanner } from "./BlockedBanner";
// ...inside the returned root element, before existing content:
<BlockedBanner labels={issue.labels} />
```

(`Issue.labels` is `string[]` per `tracker/src/types/issue.ts:63`.)

- [ ] **Step 4: Run to verify pass + summary tab regressions**

Run: `cd tracker && npx vitest run src/components/issues/issue-detail/__tests__`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/BlockedBanner.tsx tracker/src/components/issues/issue-detail/SummaryTab.tsx tracker/src/components/issues/issue-detail/__tests__/BlockedBanner.test.tsx
git commit -m "feat(tracker-ui): blocked-run banner in issue summary"
```

---

### Task 9: Harden the `push` skill + docs

**Files:**
- Modify: `.claude/skills/push/SKILL.md`
- Modify: `elixir/README.md` (orchestration behavior section)
- Modify: `SPEC.md` (run lifecycle section)

- [ ] **Step 1: Append to `.claude/skills/push/SKILL.md`** (after the `## Notes` section)

```markdown
## Definition of done (Symphony publish gate)

Symphony's orchestrator verifies these exact conditions after your run; the
turn is not done until ALL hold for every repo where you made commits:

1. The working tree is clean (`git status --porcelain` is empty) — commit or
   intentionally discard everything.
2. The current branch has an upstream (`git rev-parse --abbrev-ref @{upstream}`
   succeeds). If it fails, you have not pushed: run `git push -u origin HEAD`.
3. An open (or merged) pull request exists for the branch:
   `gh pr list --head "$(git branch --show-current)" --json url,state` returns
   a non-closed entry.

Self-check before ending the turn:

```sh
git status --porcelain                       # must be empty
git rev-parse --abbrev-ref '@{upstream}'     # must succeed
gh pr list --head "$(git branch --show-current)" --json url,state --limit 1
```

If any check fails, fix it now — do not end the turn and assume someone else
will publish. If Symphony has to publish for you (finalizer), the PR will be
flagged for extra-careful review.
```

- [ ] **Step 2: Update `elixir/README.md`**

Add a short subsection under the orchestration/behavior docs:

```markdown
### Publish gate (run contract)

After each agent run, the orchestrator verifies deliverables before applying
`completion_transitions`: every repo in the workspace with committed work must
have a pushed branch and a non-closed pull request. Violations trigger up to 2
corrective agent turns; if work remains unpublished, Symphony pushes the branch
(`symphony/<identifier>` when work sits on the default branch) and opens the PR
mechanically. If even that fails, the issue receives the `symphony:blocked`
label plus a workpad note and is NOT transitioned. Verified/created PRs are
linked to the issue deterministically (origin `agent`).
```

- [ ] **Step 3: Update `SPEC.md`** run lifecycle with the same paragraph (condensed), keeping spec/implementation aligned per `elixir/AGENTS.md`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/push/SKILL.md elixir/README.md SPEC.md
git commit -m "docs: publish gate behavior and push skill definition of done"
```

---

### Task 10: Full gates

- [ ] **Step 1: Elixir quality gate**

Run: `make -C elixir all`
Expected: format check, credo, tests with coverage, dialyzer all green. Fix any `@spec` complaints (`mix specs.check`) — all new public functions above already carry specs.

- [ ] **Step 2: Tracker tests**

Run: `cd tracker && npx vitest run`
Expected: all pass.

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -A && git commit -m "chore: address quality-gate findings for run contract phase 1"
```

---

## Self-review (against spec Phase 1)

- Gate of conclusão (diff → push → PR): Tasks 1, 2, 7 ✓
- Turn corretivo + fallback mecânico: Tasks 4, 5 ✓
- Estado de entregáveis no prompt de retry/continuação: Task 3 ✓
- PR determinístico no issue detail (identifiers tipo GAM-5): Tasks 6, 7 ✓
- `symphony:blocked` + violação visível: Tasks 7, 8 ✓
- Skill `push` endurecida: Task 9 ✓
- No-op path: clean workspace ⇒ `evaluate_publish` returns `:satisfied` (Task 2) ✓ — workpad-recorded no-op rationale lands in Phase 2.
- `run-state.json` checkpoint file: deliberately replaced by ground-truth re-inspection in this phase (`repo_states/1` recomputes on every dispatch/turn); the stage file becomes necessary in later phases when PLAN/VALIDATE stages exist.
