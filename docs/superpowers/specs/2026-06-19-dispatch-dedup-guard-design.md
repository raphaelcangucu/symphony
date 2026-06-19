# Dispatch De-duplication Guard — Design (follow-up)

> **Follow-up from the CDE-1139 evidence-integrity work.** While debugging the
> CDE-1139 `turn_aborted`, we found that the issue had **two concurrent top-level
> Codex agents running in the same worktree** (`advising/CDE-1139`) at the same
> time. Symphony's only protection against double-dispatch lives in the
> Orchestrator GenServer's **in-memory** `running`/`claimed` state — which is
> dropped on every orchestrator restart (e.g. `make update --orchestrator`) and
> is never reconstructed by adopting in-flight workers. There is **no durable,
> workspace-level lock**, so a restart-then-redispatch (or a manual dispatch
> racing a recovered orchestrator) can spawn a second agent in a worktree that
> already has a live one. Two agents editing the same files can clobber each
> other and corrupt evidence.

## 1. Incident (evidence)

Two Codex rollouts, both with `cwd = /home/.../advising-workspaces/advising/CDE-1139`,
were alive simultaneously:

| Session | thread id | started | last activity | ended as |
|---|---|---|---|---|
| A (PT) | `019ee1e4-786f-…` | 18:58:27 | "Vou editar agora… criar quatro arquivos `.spec.js`" @ 19:01:16 | **`turn_aborted`** @ 19:01:27 |
| B (EN) | `019ee1e5-8357-…` | 18:59:35 | "Inspected only; no files edited" @ 19:01:26 | wrapped @ 19:01:26 |

Both stopped **within the same second** (19:01:26–27) → a single global event
(an `OrchestratorSupervisor` subtree restart used to deploy the evidence-integrity
gate) tore down the whole subtree at once. That restart is also the most likely
origin of the *second* agent: the orchestrator came back with empty state and
re-dispatched CDE-1139 while a prior worker was still alive.

> Note: the 18:58–19:01 Symphony logs have already rotated out (oldest available
> begins 19:29), so the exact restart line is gone. The duplication mechanism
> below is **confirmed from the architecture**; the precise trigger ordering for
> this incident is **inferred** from the two rollouts + the simultaneous teardown.

## 2. Root cause

De-duplication is **entirely in-memory and orchestrator-local**, with three gaps:

1. **Guards key off volatile in-memory state.** The auto poll-loop refuses to
   dispatch an issue that is already `claimed`/`running`:

```elixir
# elixir/lib/symphony_elixir/orchestrator.ex:561
  defp should_dispatch_issue?(
         %Issue{} = issue,
         %State{running: running, claimed: claimed} = state,
         active_states,
         terminal_states
       ) do
    candidate_issue?(issue, active_states, terminal_states) and
      !issue_blocked_by_non_terminal?(issue, terminal_states) and
      !MapSet.member?(claimed, issue.id) and
      !Map.has_key?(running, issue.id) and
      available_slots(state) > 0 and
      state_slots_available?(issue, running)
  end
```

   …and the manual path rejects an already-running issue (`orchestrator.ex:1871`,
   `Map.has_key?(state.running, issue.id) -> {:error, :already_running}`). Both
   are correct **only while `state.running`/`state.claimed` are intact**.

2. **Restart drops all knowledge of in-flight workers; boot does not adopt
   them.** The orchestrator initializes with empty maps and reconstructs nothing
   from a durable source:

```elixir
# elixir/lib/symphony_elixir/orchestrator.ex:57 (State struct defaults; init/1 builds %State{} from these)
      running: %{},
      ...
      claimed: MapSet.new(),
```

   `make update --orchestrator` → `Ctl.restart([:orchestrator])` does
   `Supervisor.terminate_child/2` + `Supervisor.restart_child/2` on the whole
   `OrchestratorSupervisor` subtree (`ctl.ex:44-66`). After restart the first
   `maybe_dispatch` tick sees CDE-1139 as a fresh candidate (it is not in the
   now-empty `running`/`claimed`) and dispatches it again.

   **Worse with `:one_for_one`.** `OrchestratorSupervisor` supervises the
   `Orchestrator` GenServer and `Orchestrator.TaskSupervisor` as **siblings**
   under `strategy: :one_for_one` (`orchestrator_supervisor.ex:18,23-30`). So if
   the `Orchestrator` GenServer alone crashes/restarts (an unhandled error in a
   `handle_*`), its sibling `TaskSupervisor` is **not** restarted — the live
   worker Tasks (and their Codex ports) keep running — while the restarted
   orchestrator boots empty and re-dispatches. That is a clean path to two live
   agents in one worktree without any full-subtree restart at all.

3. **No workspace-level mutual exclusion.** Workers are spawned under a
   `Task.Supervisor` and tracked only by `issue.id` → pid in memory:

```elixir
# elixir/lib/symphony_elixir/orchestrator.ex:745
    case Task.Supervisor.start_child(SymphonyElixir.Orchestrator.TaskSupervisor, fn ->
           AgentRunner.run(issue, recipient, attempt: attempt, members: members)
         end) do
      {:ok, pid} ->
        ref = Process.monitor(pid)
        ...
        running = Map.put(state.running, issue.id, dispatch_running_entry(pid, ref, issue, agent_kind, attempt, members))
```

   Nothing on disk (in the worktree) records "an agent owns this workspace", so a
   fresh orchestrator — or a worker whose Codex OS process outlived its managing
   `Task` — has no way to detect an existing live agent in the same directory.

## 3. Goal

A worktree must never host **two concurrent top-level agents**. Specifically:

- A restart of the orchestrator must not spawn a duplicate agent for an issue
  whose previous agent is still alive — it must either **adopt** it or **reap**
  it before dispatching.
- Manual dispatch (`request_dispatch`/`hard_reset`) racing the auto poll loop, or
  racing a just-restarted orchestrator, must resolve to **exactly one** agent per
  workspace.

## 4. Proposed approach (defense in depth)

1. **Durable workspace lock (primary).** Before `AgentRunner.run` spawns the
   agent, atomically create a lock in the worktree (e.g.
   `<workspace>/.symphony/agent.lock`) holding `{issue_id, session_id, os_pid,
   started_at, host}`; release it on normal/abnormal exit. Dispatch refuses (and
   logs) when a **live** lock exists (liveness = pid alive and recent heartbeat).
   This survives orchestrator restarts because it lives on disk, not in GenServer
   state.
2. **Boot-time adoption / reconciliation.** On `Orchestrator.init` (or first
   tick), scan known worktrees for live locks (and/or the issue's persisted
   `worker_id`/`agent_session_id`) and either re-attach a monitor or terminate
   the orphan **before** running `maybe_dispatch`. Today `init` trusts the empty
   maps blindly.
3. **Guarantee orphan reaping on teardown.** Verify that terminating the
   `OrchestratorSupervisor` subtree (and `terminate_running_issue`,
   `orchestrator.ex:408`) actually kills the **Codex OS process group**, not just
   the Elixir `Task`. If the app-server child can outlive its `Task`/port, it
   keeps writing its rollout in the workspace (consistent with session A above).
4. **(Optional) Single-flight key.** Make the dispatch decision idempotent on a
   stable key (workspace path) shared by both the manual and auto paths, so the
   lock — not in-memory state — is the source of truth.

## 5. Acceptance criteria

- **Repro test:** dispatch an issue; while its agent is live, run
  `make update --orchestrator` (or kill the `Orchestrator` GenServer). Assert that
  afterward there is **exactly one** live Codex process / worker for that
  workspace — never two — and that its rollout `cwd` is unique.
- **Race test:** with an agent already live for an issue, a manual
  `request_dispatch`/`hard_reset` does not produce a second worker in the same
  worktree (it adopts/blocks instead).
- **Lock semantics test:** a stale lock (dead pid / expired heartbeat) does not
  block a legitimate re-dispatch; a live lock does.
- **No regression:** normal single-agent dispatch, retries, and group dispatch
  behave as before.

## 6. References

- Rollouts: `~/.codex/sessions/2026/06/19/rollout-2026-06-19T18-58-27-019ee1e4-*.jsonl`
  and `…T18-59-35-019ee1e5-*.jsonl` (both `cwd` = `advising/CDE-1139`).
- Guards: `elixir/lib/symphony_elixir/orchestrator.ex` — `should_dispatch_issue?`
  (561), `request_dispatch` `:already_running` (1871), `do_dispatch_issue` (740),
  boot state (57–59), `terminate_running_issue` (408).
- Supervision/restart: `elixir/lib/symphony_elixir/orchestrator_supervisor.ex`
  (`{Task.Supervisor, name: Orchestrator.TaskSupervisor}` + `Orchestrator`),
  `elixir/lib/symphony_elixir/ctl.ex` `restart/2` (44–66).
- Sibling work: `docs/superpowers/specs/2026-06-19-evidence-integrity-design.md`.
