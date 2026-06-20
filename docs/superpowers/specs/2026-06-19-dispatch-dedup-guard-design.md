# Dispatch De-duplication Guard — Design (follow-up)

> **Follow-up from the CDE-1139 evidence-integrity work.** While debugging the
> CDE-1139 `turn_aborted`, we found the issue had **two concurrent top-level
> Codex agents in the same worktree** (`advising/CDE-1139`). The in-memory
> dispatch guard is **not** the problem — it is correct. The bug is that the
> orchestrator can **forget a worker that is still alive**: an agent's OS process
> can orphan itself, and a sibling `Task.Supervisor` lets workers outlive an
> orchestrator restart. Fix is **two small changes that reuse patterns already in
> the codebase** — no lock manager, no DB column, no heartbeat, no boot adoption.

## 1. Incident (evidence)

Two Codex rollouts, both with `cwd = …/advising-workspaces/advising/CDE-1139`,
alive at the same time:

| Session | thread id | started | last activity | ended as |
|---|---|---|---|---|
| A (PT) | `019ee1e4-786f-…` | 18:58:27 | "Vou editar agora… criar quatro `.spec.js`" @ 19:01:16 | **`turn_aborted`** @ 19:01:27 |
| B (EN) | `019ee1e5-8357-…` | 18:59:35 | "Inspected only; no files edited" @ 19:01:26 | wrapped @ 19:01:26 |

Both stopped **within the same second** (a full `OrchestratorSupervisor` subtree
restart, used to deploy the evidence-integrity gate, tore everything down). The
*second* agent appeared because the orchestrator came back with empty state and
re-dispatched CDE-1139 while a prior worker was still alive.

> The 18:58–19:01 Symphony logs already rotated out (oldest available begins
> 19:29), so the exact restart line is gone. The mechanism below is **confirmed
> from the architecture**; the precise trigger ordering is **inferred** from the
> two rollouts + the simultaneous teardown.

## 2. Root cause — state diverges from reality

The dedup guard itself is fine. The auto poll-loop refuses an issue already in
`running`/`claimed`, and the manual path returns `:already_running`
(`orchestrator.ex:561` and `:1871`). These are correct **as long as in-memory
state matches reality**. Two gaps let them diverge:

**A. The Codex OS process can orphan itself.** `coding_agent.start_port/2` spawns
`bash -lc <codex>` with **no `setsid`** and no process-group kill:

```elixir
# elixir/lib/symphony_elixir/codex/coding_agent.ex:380
  defp start_port(workspace, codex_section) do
    executable = System.find_executable("bash")
    ...
      Port.open(
        {:spawn_executable, String.to_charlist(executable)},
        [:binary, :exit_status, :stderr_to_stdout,
         args: [~c"-lc", String.to_charlist(CodexConfig.command(codex_section))],
         cd: String.to_charlist(workspace), line: @port_line_bytes]
      )
```

When the managing `Task` dies the BEAM kills `bash`, but the real Codex child can
be reparented to init and **keep writing its rollout** — exactly session A above.
The Cursor CLI path already solves this: `setsid --wait` + `kill -9 -<pgid>`
(`cli_runner.ex:83-104`, `kill_port/1` at `:442-451`).

**B. Workers can outlive the orchestrator's memory.** They run under a sibling
`Task.Supervisor` in `:one_for_one`:

```elixir
# elixir/lib/symphony_elixir/orchestrator_supervisor.ex:18,22
  Supervisor.init(child_specs(), strategy: :one_for_one)
  ...
  def child_specs do
    [
      {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor},
      SymphonyElixir.Orchestrator,
      ...
    ]
  end
```

If only the `Orchestrator` GenServer restarts (an error in a `handle_*`), the
`TaskSupervisor` sibling is **not** restarted — live workers keep running — while
the orchestrator boots empty (`running: %{}, claimed: MapSet.new()`,
`orchestrator.ex:57,59`; `init/1` adopts nothing) and re-dispatches → a second
agent in the same worktree.

## 3. Goal

A worktree never hosts two concurrent top-level agents — **without** introducing
a parallel tracking system. After any orchestrator restart there must be **no
surviving worker**, so the existing in-memory `running`/`claimed` check is the
complete and correct source of truth.

## 4. Fix (two small levers, reuse existing code)

1. **Reap the Codex process group on teardown.** Give `coding_agent.start_port/2`
   the same treatment the Cursor `cli_runner` already uses: spawn under `setsid`
   and, when the port/Task goes away, `kill -9 -<pgid>` (fallback `pkill -P` +
   `kill -9`). This guarantees no orphaned Codex process keeps editing a workspace
   after its `Task` is gone. Localized change in one function; lift the helper
   from `cli_runner.ex:83-104`/`:442-451`.

2. **Make workers die with the orchestrator.** Stop workers from outliving the
   GenServer's memory of them. Simplest options (pick one):
   - reorder `child_specs` to `[Orchestrator, TaskSupervisor, …]` and use
     `strategy: :rest_for_one`, so a crashed `Orchestrator` also restarts the
     `TaskSupervisor` (and kills its workers); **or**
   - have `do_dispatch_issue` link the spawned task to the `Orchestrator` process
     so the task receives the exit signal when the GenServer dies.

With both, no new state is added: after a restart the worker set is empty for
real, and `should_dispatch_issue?` / `:already_running` already do the rest.

> **Single-primitive alternative (if supervision surgery is unwanted):** wrap the
> agent in `setsid flock -n <workspace>/.symphony/agent.lock …`. The kernel
> releases the lock when the process dies (no stale-lock/heartbeat/adoption);
> dispatch just attempts `flock -n` and skips when the worktree is held. This
> still needs lever **1** so the lock-holder reaps its children.

## 5. Acceptance criteria

- **Reaping:** kill an agent's managing `Task` (or restart the orchestrator) and
  assert **no** Codex OS process remains for that workspace (no rollout keeps
  growing).
- **Restart de-dup:** dispatch an issue; while its agent is live, crash/restart
  the `Orchestrator` GenServer **and** run `make update --orchestrator`. After
  each, assert **exactly one** live worker for that workspace — never two.
- **No regression:** normal single-agent dispatch, retries, group dispatch, and
  in-flight-turn survival across a `--web` restart all behave as before.

## 6. References

- Incident rollouts: `~/.codex/sessions/2026/06/19/rollout-2026-06-19T18-58-27-019ee1e4-*.jsonl`
  and `…T18-59-35-019ee1e5-*.jsonl` (both `cwd` = `advising/CDE-1139`).
- Codex spawn (no setsid): `elixir/lib/symphony_elixir/codex/coding_agent.ex`
  `start_port/2` (380).
- Working pattern to copy: `elixir/lib/symphony_elixir/cursor/cli_runner.ex`
  `setsid` spawn (83-104), `kill_port/1` (442-451).
- Guards (already correct): `elixir/lib/symphony_elixir/orchestrator.ex`
  `should_dispatch_issue?` (561), `:already_running` (1871), `do_dispatch_issue`
  (740/745), boot state (57/59), `terminate_running_issue` (408).
- Supervision: `elixir/lib/symphony_elixir/orchestrator_supervisor.ex`
  (`:one_for_one`, `child_specs/0`).
- Sibling work: `docs/superpowers/specs/2026-06-19-evidence-integrity-design.md`.
