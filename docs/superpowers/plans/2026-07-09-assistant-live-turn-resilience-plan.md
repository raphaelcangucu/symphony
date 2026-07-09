# Assistant Live Turn Resilience Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in this chat with checkpoints after each task. Run Elixir tests from `elixir/`; tracker tests from `tracker/`.

**Goal:** Make durable assistant turns visible and controllable on every joined tab — live tool/command updates via PubSub, mid-turn snapshot on reconnect, Stop turn + Kill command via one agent-agnostic contract — plus rename `CodexSession` → `AgentSession`.

**Architecture:** Extend the existing goal-thread PubSub fan-out in `AssistantChannel.turn_stream_opts/4` to all durable threads; persist `active_tools` + `last_activity_at` on `metadata.current_turn` via `History`; standardize on `{:agent_interrupt}` / `{:kill_tool, id}` for **all** backends (**Codex primary**; Claude / Cursor / OpenCode share the same channel events and worker messages — Codex maps the new messages in its receive loop, CLI agents handle them in `Agent.CliRunner.Base.receive_loop/5`); surface Stop/Kill + command text in `WorkingIndicator` and tool rows.

**Tech Stack:** Elixir / Phoenix Channels, Ecto + SQLite, `GoalRun` PubSub, React/TypeScript (`tracker/`), ExUnit, Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-09-assistant-live-turn-resilience-design.md`

---

## Conventions for the executing engineer (read first)

- Elixir paths are under `elixir/`. Run: `cd elixir && mix test <file>`.
- Tracker paths are under `tracker/`. Run: `cd tracker && npm test -- <file>` (or the repo’s existing vitest script).
- Public `def` in `lib/` needs `@spec` (`mix specs.check`).
- `metadata.current_turn` uses **string keys** and ISO8601 datetime **strings**.
- Reuse `History.update_thread/2` / `patch_current_turn` for metadata writes.
- Keep commits small (one per task). Conventional Commits.
- Do **not** stage unrelated dirty files (e.g. existing locale tweaks in `tracker/locales/` unless this task owns them).

---

## File Structure

**Rename**

- `elixir/lib/symphony_elixir/assistant/codex_session.ex` → `agent_session.ex` (`SymphonyElixir.Assistant.AgentSession`)
- Tests: `codex_session*_test.exs` → `agent_session*_test.exs`

**Modify (backend)**

- `elixir/lib/symphony_elixir/assistant/history.ex` — `active_tools` / `last_activity_at` helpers; extend `turn_payload/1`; clear tools on interrupt/complete/fail
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` — fan-out all durable streams; `stop_turn` / `kill_tool`; hydrate join
- `elixir/lib/symphony_elixir/assistant/turn_manager.ex` — interrupt/kill routing to worker pid
- `elixir/lib/symphony_elixir/agent/cli_runner/base.ex` — shared `{:agent_interrupt}` / `{:kill_tool, id}` for Claude / Cursor / OpenCode CLI path
- `elixir/lib/symphony_elixir/codex/coding_agent.ex` — accept `{:agent_interrupt}` / `{:kill_tool, id}` (primary); keep `{:codex_interrupt}` as alias
- `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex` (and Cursor/OpenCode runners using Base) — ensure interrupt reaches Base loop
- Call sites of `CodexSession` (channel, controllers, issue_dispatch, etc.)

**Modify (frontend)**

- `tracker/src/services/phoenix/assistantChannel.ts` — `activeTools` on turn status; `stopTurn` / `killTool` helpers
- `tracker/src/components/assistant/WorkingIndicator.tsx` — command summary + Stop/Kill
- `tracker/src/components/assistant/assistantToolCall.ts` — expand running Bash/shell by default
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` / `AssistantMessageList.tsx` / tool timeline — hydrate snapshot, wire actions
- Locales: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`

**Docs**

- Amend non-goal in `docs/superpowers/specs/2026-06-21-assistant-turn-session-tracking-design.md`

---

### Task 1: Rename `CodexSession` → `AgentSession`

**Files:**
- Rename: `elixir/lib/symphony_elixir/assistant/codex_session.ex` → `agent_session.ex`
- Rename tests under `elixir/test/symphony_elixir/assistant/` matching `codex_session*`
- Update all `alias SymphonyElixir.Assistant.CodexSession` / `CodexSession.` references in `elixir/lib` and `elixir/test`

- [ ] **Step 1: Rename module and file**

```bash
cd /home/raphaelcangucu/symphony
git mv elixir/lib/symphony_elixir/assistant/codex_session.ex \
  elixir/lib/symphony_elixir/assistant/agent_session.ex
```

In `agent_session.ex`, change:

```elixir
defmodule SymphonyElixir.Assistant.AgentSession do
```

Update `@moduledoc` to say it is the shared assistant turn runner for all agent backends (**Codex primary**; Claude, Cursor, OpenCode share the same contracts), not a Codex-only module.

- [ ] **Step 2: Rename test modules/files**

```bash
# Adjust exact filenames to what exists:
git mv elixir/test/symphony_elixir/assistant/codex_session_test.exs \
  elixir/test/symphony_elixir/assistant/agent_session_test.exs
git mv elixir/test/symphony_elixir/assistant/codex_session_claude_relay_test.exs \
  elixir/test/symphony_elixir/assistant/agent_session_claude_relay_test.exs
```

Rename `defmodule …CodexSession…` → `…AgentSession…` and aliases inside those tests.

- [ ] **Step 3: Update call sites**

```bash
cd elixir && rg -n "Assistant\.CodexSession|alias .*CodexSession|CodexSession\." lib test --glob '*.ex' --glob '*.exs'
```

Replace with `AgentSession` everywhere in `lib/` and `test/`. No deprecated alias.

- [ ] **Step 4: Run tests**

```bash
cd elixir && mix test test/symphony_elixir/assistant/agent_session_test.exs test/symphony_elixir/assistant/agent_session_claude_relay_test.exs
```

Expected: PASS (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add -A elixir/lib/symphony_elixir/assistant/agent_session.ex \
  elixir/lib/symphony_elixir/assistant/codex_session.ex \
  elixir/test/symphony_elixir/assistant/agent_session*.exs \
  elixir/lib elixir/test
git commit -m "$(cat <<'EOF'
refactor(assistant): rename CodexSession to AgentSession

Summary:
- Shared turn runner serves all agent backends; name now matches reality.

Rationale:
- Live-turn resilience work builds on this module; Codex-named API was misleading.

Tests:
- mix test agent_session*_test.exs

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 2: `History` mid-turn `active_tools` snapshot

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Test: `elixir/test/symphony_elixir/assistant/turn_history_test.exs` (extend existing)

- [ ] **Step 1: Write failing tests**

Append to `turn_history_test.exs`:

```elixir
test "upsert_active_tool records tool and last_activity_at", %{thread: thread} do
  assert {:ok, thread} =
           History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

  tool = %{
    "id" => "tool-1",
    "name" => "Bash",
    "arguments_summary" => "pest --parallel --shard=3/3",
    "started_at" => "2026-07-09T12:00:00Z"
  }

  assert {:ok, updated} = History.upsert_active_tool(thread, tool)
  turn = History.current_turn(updated)
  assert turn["active_tools"] == [tool]
  assert is_binary(turn["last_activity_at"])

  payload = History.turn_payload(updated)
  assert payload.active_tools == [tool]
  assert is_binary(payload.last_activity_at)
end

test "remove_active_tool drops matching id", %{thread: thread} do
  assert {:ok, thread} =
           History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

  {:ok, thread} =
    History.upsert_active_tool(thread, %{
      "id" => "tool-1",
      "name" => "Bash",
      "arguments_summary" => "ls",
      "started_at" => "2026-07-09T12:00:00Z"
    })

  assert {:ok, updated} = History.remove_active_tool(thread, "tool-1")
  assert History.current_turn(updated)["active_tools"] == []
end

test "interrupt_turn_state clears active_tools", %{thread: thread} do
  assert {:ok, thread} =
           History.start_turn_state(thread, %{trigger: "user", prompt: "go", agent_kind: "claude"})

  {:ok, thread} =
    History.upsert_active_tool(thread, %{
      "id" => "tool-1",
      "name" => "Bash",
      "arguments_summary" => "ls",
      "started_at" => "2026-07-09T12:00:00Z"
    })

  assert {:ok, updated} = History.interrupt_turn_state(thread, "user_stop")
  turn = History.current_turn(updated)
  assert turn["status"] == "interrupted"
  assert turn["active_tools"] in [nil, []]
end
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd elixir && mix test test/symphony_elixir/assistant/turn_history_test.exs --only line:REPLACE
```

Or run the whole file; expect undefined function `upsert_active_tool/2`.

- [ ] **Step 3: Implement helpers**

In `history.ex`:

```elixir
@spec upsert_active_tool(Thread.t(), map()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
def upsert_active_tool(%Thread{} = thread, tool) when is_map(tool) do
  id = tool["id"] || tool[:id]
  if is_nil(id) or id == "", do: raise(ArgumentError, "active tool requires id")

  patch_current_turn(thread, fn turn ->
    tools = List.wrap(turn["active_tools"])
    tools = Enum.reject(tools, &(&1["id"] == id)) ++ [stringify_tool(tool)]

    turn
    |> Map.put("active_tools", tools)
    |> Map.put("last_activity_at", now_iso())
  end)
end

@spec remove_active_tool(Thread.t(), String.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
def remove_active_tool(%Thread{} = thread, tool_id) when is_binary(tool_id) do
  patch_current_turn(thread, fn turn ->
    tools = Enum.reject(List.wrap(turn["active_tools"]), &(&1["id"] == tool_id))

    turn
    |> Map.put("active_tools", tools)
    |> Map.put("last_activity_at", now_iso())
  end)
end

@spec touch_turn_activity(Thread.t()) :: {:ok, Thread.t()} | {:error, Ecto.Changeset.t()}
def touch_turn_activity(%Thread{} = thread) do
  patch_current_turn(thread, &Map.put(&1, "last_activity_at", now_iso()))
end
```

Update `interrupt_turn_state/2`, `complete_turn_state/2`, and `fail_turn_state/2` to also `Map.put("active_tools", [])` (or `Map.delete`).

Extend `turn_payload/1`:

```elixir
def turn_payload(turn) when is_map(turn) do
  %{
    status: turn["status"],
    trigger: turn["trigger"],
    session_id: turn["session_id"],
    codex_thread_id: turn["codex_thread_id"],
    turn_id: turn["turn_id"],
    started_at: turn["started_at"],
    finished_at: turn["finished_at"],
    can_resume: turn["status"] == "interrupted",
    active_tools: List.wrap(turn["active_tools"]),
    last_activity_at: turn["last_activity_at"]
  }
end
```

Add private `stringify_tool/1` that normalizes keys to strings: `id`, `name`, `arguments_summary`, `started_at`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd elixir && mix test test/symphony_elixir/assistant/turn_history_test.exs
```

- [ ] **Step 5: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/history.ex \
  elixir/test/symphony_elixir/assistant/turn_history_test.exs
git commit -m "$(cat <<'EOF'
feat(assistant): persist mid-turn active_tools snapshot

Summary:
- History upsert/remove active tools and expose them on turn_payload.

Rationale:
- Reconnect needs a durable snapshot of the running Bash/command.

Tests:
- mix test turn_history_test.exs

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 3: PubSub fan-out for all durable turns

**Files:**
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (`turn_stream_opts/4`, stream handler)
- Test: `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs` (or new focused test)

- [ ] **Step 1: Write failing channel test**

Pattern: join two sockets on the same durable thread topic; start a turn with a fake runner that emits `on_tool_call_started`; assert the **second** socket receives `tool_call_started`.

Sketch (adapt to existing channel test helpers):

```elixir
test "second subscriber receives tool_call_started via PubSub", %{...} do
  # join socket_a and socket_b on assistant:thread:<id>
  # configure :assistant_runner to call on_tool_call_started then complete
  # send_message from socket_a
  assert_push "tool_call_started", %{tool_call: %{name: "Bash"}}, 2000  # on socket_b
end
```

Use the project’s existing `Phoenix.ChannelTest` dual-socket pattern if present; otherwise open two sockets with `subscribe_and_join`.

- [ ] **Step 2: Run test — expect FAIL** (second socket gets nothing)

- [ ] **Step 3: Change `turn_stream_opts` fan-out**

Replace goal-only broadcast with durable-thread broadcast:

```elixir
push_stream = fn event, payload ->
  push(socket, event, payload)

  if is_integer(thread_id) and durable_thread?(thread) do
    GoalRun.broadcast_from(channel_pid, thread_id, {:turn_stream, event, payload})
  end
end
```

Define `durable_thread?/1` as true when the thread has an integer `id` and is joined via `assistant:thread:*` (not the legacy project-scoped topic). Goal threads already subscribe via `TurnManager.subscribe/1` — keep that.

Add handler (alongside or replacing goal-only):

```elixir
def handle_info({:turn_stream, event, payload}, socket) do
  push(socket, event, payload)
  {:noreply, socket}
end

# Keep {:goal_stream, ...} as a thin alias for compatibility:
def handle_info({:goal_stream, event, payload}, socket) do
  handle_info({:turn_stream, event, payload}, socket)
end
```

Update any remaining `broadcast_from(..., {:goal_stream, ...})` for goals to `{:turn_stream, ...}` **or** broadcast both during transition — prefer one tuple (`:turn_stream`) everywhere.

Also wrap tool callbacks to update History:

```elixir
|> Keyword.put(:on_tool_call_started, fn tool_call ->
  maybe_upsert_active_tool(thread_id, tool_call)
  push_stream.("tool_call_started", %{tool_call: tool_call})
end)
|> Keyword.put(:on_tool_call_completed, fn tool_call ->
  maybe_remove_active_tool(thread_id, tool_call)
  push_stream.("tool_call_completed", %{tool_call: tool_call})
end)
```

`maybe_upsert_active_tool/2` loads the thread, builds `%{"id" => …, "name" => …, "arguments_summary" => summarize(tool_call), "started_at" => now}`, calls `History.upsert_active_tool/2`. Summarize Bash as the command string from `arguments["command"]` when present; otherwise a short JSON/string truncate (≤ 200 chars).

- [ ] **Step 4: Run channel tests — expect PASS**

```bash
cd elixir && mix test test/symphony_elixir_web/channels/assistant_channel_test.exs
```

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(assistant): fan out live turn streams on PubSub

Summary:
- Durable threads broadcast deltas/tools to all joined tabs; snapshot tools in History.

Rationale:
- Originating-socket-only streaming left reconnected UIs on Crunching with no command.

Tests:
- mix test assistant_channel_test.exs

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 4: Agent interrupt in `CliRunner.Base.receive_loop`

**Files:**
- Modify: `elixir/lib/symphony_elixir/agent/cli_runner/base.ex`
- Test: `elixir/test/symphony_elixir/agent/cli_runner/base_test.exs` (create if missing)

- [ ] **Step 1: Write failing test**

```elixir
test "receive_loop kills port on {:agent_interrupt}" do
  # open a long-running port (e.g. bash -lc 'sleep 30')
  # spawn receive_loop in a Task
  # send {:agent_interrupt} to that Task
  # assert loop returns {:error, :interrupted} (or agreed atom)
  # assert port is closed / process gone
end
```

- [ ] **Step 2: Run — expect FAIL** (message ignored / timeout)

- [ ] **Step 3: Handle interrupt in `receive_loop`**

In `receive_loop/5` `receive` clauses, add:

```elixir
{:agent_interrupt} ->
  kill_port(port)
  {:error, :interrupted}

{:kill_tool, _tool_call_id} ->
  # Best-effort: kill direct children of the CLI process group leader, keep port open.
  case :erlang.port_info(port, :os_pid) do
    {:os_pid, os_pid} ->
      # Prefer pkill -P for direct children; if setsid group, kill children of claude pid.
      System.cmd("pkill", ["-9", "-P", to_string(os_pid)], stderr_to_stdout: true)
      :ok

    _ ->
      :ok
  end

  receive_loop(port, timeout_ms, pending_line, state, handlers)
```

Document: `{:kill_tool, id}` is best-effort; if no children, caller may escalate to full interrupt. Returning `:ok` from the clause and continuing the loop keeps the turn alive.

- [ ] **Step 4: Wire all backends to the shared contract**

**Codex (primary):** In `Codex.CodingAgent` receive loop, handle `{:agent_interrupt}` the same as `{:codex_interrupt}`; handle `{:kill_tool, id}` with best-effort child kill or return unsupported so channel can offer Stop. Keep `{:codex_interrupt}` as a one-release alias only inside Codex.

**Claude / Cursor / OpenCode (CLI / Base):** Ensure the Task that runs `CliRunner.run_turn` is the same pid TurnManager registers, so `send(turn_pid, {:agent_interrupt})` reaches `receive_loop`. If a runner nests another process, forward interrupt into the Base loop.

Channel/UI never send agent-specific interrupt atoms — only `stop_turn` / `kill_tool` → TurnManager → `{:agent_interrupt}` / `{:kill_tool, id}`.

- [ ] **Step 5: Run tests — PASS**

```bash
cd elixir && mix test test/symphony_elixir/agent/cli_runner/base_test.exs
# Plus a focused Codex interrupt alias test if one exists / add beside coding_agent tests
```

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): shared agent_interrupt and kill_tool contract

Summary:
- Base.receive_loop + Codex CodingAgent honor the same interrupt/kill messages.

Rationale:
- Codex is primary; Claude/Cursor/OpenCode must share contracts, not Codex-only atoms.

Tests:
- mix test base_test.exs (+ Codex interrupt coverage)

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 5: Channel `stop_turn` + TurnManager interrupt

**Files:**
- Modify: `elixir/lib/symphony_elixir/assistant/turn_manager.ex`
- Modify: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test: channel + turn_manager tests

- [ ] **Step 1: Failing tests**

```elixir
test "stop_turn interrupts running turn and clears active_tools", %{socket: socket, thread: thread} do
  # Prefer a Codex-shaped fake runner that waits for {:agent_interrupt}
  # (primary). Also cover a CLI-shaped runner that uses Base.receive_loop.
  push(socket, "stop_turn", %{})
  assert_reply ..., :ok
  # assert History.current_turn status interrupted, reason user_stop
  assert_push "turn_status", %{status: "interrupted"}
end
```

- [ ] **Step 2: Implement `TurnManager.interrupt/2`**

```elixir
@spec interrupt(integer(), String.t()) :: :ok | {:error, term()}
def interrupt(thread_id, reason) when is_integer(thread_id) and is_binary(reason) do
  GenServer.call(__MODULE__, {:interrupt, thread_id, reason})
end
```

In `handle_call({:interrupt, thread_id, reason}, …)`:

1. Lookup worker pid from registry
2. If pid: `send(pid, {:agent_interrupt})` only (Codex aliases internally; do not require callers to know `{:codex_interrupt}`)
3. `History.interrupt_turn_state(thread, reason)` (clears active_tools from Task 2)
4. Broadcast `{:turn_status, :interrupted, History.turn_payload(thread)}`
5. Reply `:ok`

- [ ] **Step 3: Channel `handle_in("stop_turn", …)`**

```elixir
def handle_in("stop_turn", _payload, socket) do
  thread = socket.assigns.thread

  case TurnManager.interrupt(thread.id, "user_stop") do
    :ok -> {:reply, :ok, socket}
    {:error, reason} -> {:reply, {:error, %{reason: inspect(reason)}}, socket}
  end
end
```

Also update existing goal_pause / approval-cancel paths that only send `{:codex_interrupt}` to send `{:agent_interrupt}` (Codex still accepts the old atom as an alias).

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(assistant): stop_turn via shared agent_interrupt contract

Summary:
- Channel stop_turn → TurnManager → {:agent_interrupt} + durable interrupted state.

Tests:
- mix test assistant_channel_test / turn_manager_test

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 6: Channel `kill_tool`

**Files:**
- Modify: `turn_manager.ex`, `assistant_channel.ex`, `history.ex` (mark canceled if needed)
- Test: channel test

- [ ] **Step 1: Failing test**

```elixir
test "kill_tool removes active tool and notifies clients", %{socket: socket, thread: thread} do
  # seed active_tools with tool-1 via History.upsert_active_tool
  # register a fake turn pid that records {:kill_tool, "tool-1"}
  push(socket, "kill_tool", %{"tool_call_id" => "tool-1"})
  assert_reply ..., :ok
  assert History.current_turn(reload(thread))["active_tools"] == []
  assert_push "tool_call_completed", %{tool_call: %{id: "tool-1", status: "canceled"}}
end

test "kill_tool returns error when no active tool", %{socket: socket} do
  push(socket, "kill_tool", %{"tool_call_id" => "missing"})
  assert_reply ..., {:error, %{reason: "tool_not_running", can_stop_turn: true}}
end
```

- [ ] **Step 2: Implement**

`TurnManager.kill_tool(thread_id, tool_call_id)`:

1. Verify tool id is in `current_turn.active_tools`
2. `send(worker_pid, {:kill_tool, tool_call_id})` if pid present; if no pid → `{:error, :no_worker}`
3. `History.remove_active_tool(thread, tool_call_id)`
4. Broadcast `{:turn_stream, "tool_call_completed", %{tool_call: %{id: …, status: "canceled", name: …}}}`
5. Return `:ok` or `{:error, :tool_not_running}`

Channel:

```elixir
def handle_in("kill_tool", %{"tool_call_id" => tool_call_id}, socket)
    when is_binary(tool_call_id) do
  case TurnManager.kill_tool(socket.assigns.thread.id, tool_call_id) do
    :ok -> {:reply, :ok, socket}
    {:error, :tool_not_running} ->
      {:reply, {:error, %{reason: "tool_not_running", can_stop_turn: true}}, socket}
    {:error, :no_worker} ->
      {:reply, {:error, %{reason: "no_worker", can_stop_turn: true}}, socket}
  end
end
```

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(assistant): kill_tool cancels active Bash child best-effort

Summary:
- kill_tool signals the worker, clears active_tools entry, fans out canceled status.

Tests:
- mix test channel/turn_manager kill_tool cases

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 7: Frontend turn status + channel helpers

**Files:**
- Modify: `tracker/src/services/phoenix/assistantChannel.ts`
- Test: `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts`

- [ ] **Step 1: Failing tests**

```typescript
it("normalizeTurnStatus includes activeTools and lastActivityAt", () => {
  const status = normalizeTurnStatus({
    status: "running",
    active_tools: [
      {
        id: "tool-1",
        name: "Bash",
        arguments_summary: "pest --parallel",
        started_at: "2026-07-09T12:00:00Z",
      },
    ],
    last_activity_at: "2026-07-09T12:01:00Z",
  });
  expect(status.activeTools?.[0]?.argumentsSummary).toBe("pest --parallel");
  expect(status.lastActivityAt).toBe("2026-07-09T12:01:00Z");
});

it("stopTurn and killTool push the channel events", () => {
  const channel = fakeChannel();
  stopTurn(channel);
  expect(channel.push).toHaveBeenCalledWith("stop_turn", {});
  killTool(channel, "tool-1");
  expect(channel.push).toHaveBeenCalledWith("kill_tool", { tool_call_id: "tool-1" });
});
```

- [ ] **Step 2: Implement types + helpers**

Extend `AssistantTurnStatus`:

```typescript
export interface AssistantActiveTool {
  id: string;
  name: string;
  argumentsSummary: string | null;
  startedAt: string | null;
}

export interface AssistantTurnStatus {
  status: string;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  canResume: boolean;
  activeTools: AssistantActiveTool[];
  lastActivityAt: string | null;
}
```

Update `normalizeTurnStatus` to map `active_tools` / `last_activity_at`.

Add:

```typescript
export function stopTurn(channel: Channel): void {
  channel.push("stop_turn", {});
}

export function killTool(channel: Channel, toolCallId: string): void {
  channel.push("kill_tool", { tool_call_id: toolCallId });
}
```

- [ ] **Step 3: Run vitest — PASS**

```bash
cd tracker && npm test -- src/services/phoenix/__tests__/assistantChannel.test.ts
```

- [ ] **Step 4: Commit**

---

### Task 8: WorkingIndicator command + Stop/Kill

**Files:**
- Modify: `tracker/src/components/assistant/WorkingIndicator.tsx`
- Modify: `tracker/src/components/assistant/AssistantMessageList.tsx` (pass new props)
- Locales: `tracker/locales/en/tracker.json`, `pt-BR/tracker.json`
- Test: `WorkingIndicator.test.tsx`

- [ ] **Step 1: Failing UI tests**

```tsx
it("shows command summary when activeToolDetail is set", () => {
  render(
    <WorkingIndicator
      startedAt={Date.now()}
      activeToolDetail={{ name: "Bash", argumentsSummary: "pest --parallel --shard=3/3", id: "t1" }}
      onStop={vi.fn()}
      onKill={vi.fn()}
    />,
  );
  expect(screen.getByText(/pest --parallel/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /kill/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement**

Props:

```typescript
interface ActiveToolDetail {
  id: string;
  name: string;
  argumentsSummary: string | null;
}

interface WorkingIndicatorProps {
  startedAt: number;
  activeToolDetail?: ActiveToolDetail | null;
  stale?: boolean;
  onStop?: () => void;
  onKill?: (toolCallId: string) => void;
}
```

Label logic:

- If `activeToolDetail`: `Running {name} · {argumentsSummary ?? name}` (truncate summary ~80 chars)
- Else: rotating verbs (existing)
- If `stale`: append muted “No updates — Stop or Kill?”

Buttons call `onStop` / `onKill(activeToolDetail.id)`.

Add i18n keys under `assistant.working.*` for stop/kill/stale.

- [ ] **Step 3: Wire from `ProjectAssistantPanel`**

Derive `activeToolDetail` from streaming message’s running tool **or** `lastTurn.activeTools[0]`.

`stale`: `lastTurn.lastActivityAt` older than 120s while `isRunning`.

`onStop` → `stopTurn(channel)`; `onKill` → `killTool(channel, id)` and toast on error with `can_stop_turn`.

Hydrate on join: if `last_turn.status === "running"` and `active_tools.length > 0`, seed streaming assistant message toolCalls as `running` via existing `assistantStream` helpers.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

---

### Task 9: Expand running Bash + per-tool Kill

**Files:**
- Modify: `tracker/src/components/assistant/assistantToolCall.ts`
- Modify: tool timeline / `ToolCallBlock` consumer that renders Kill
- Tests: `assistantToolCall` / ToolActivity tests

- [ ] **Step 1: Failing test**

```typescript
it("does not default-collapse running Bash tools", () => {
  const view = assistantToolCallToView({
    id: "t1",
    name: "Bash",
    status: "running",
    arguments: { command: "pest --parallel" },
  });
  expect(view.defaultCollapsed).toBe(false);
});
```

- [ ] **Step 2: Implement**

```typescript
const SHELL_TOOLS = new Set(["Bash", "bash", "shell", "Shell"]);

export function assistantToolCallToView(toolCall: AssistantToolCall): ToolCallView {
  const action = isActionTool(toolCall.name);
  const shellRunning = SHELL_TOOLS.has(toolCall.name) && toolCall.status === "running";
  // ...
  return {
    // ...
    defaultCollapsed: !(action || shellRunning),
  };
}
```

Add Kill button on running tool rows in the timeline component used by `AssistantMessageList` (pass `onKillTool`).

- [ ] **Step 3: Tests PASS + commit**

---

### Task 10: Amend prior design non-goal + smoke

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-assistant-turn-session-tracking-design.md`

- [ ] **Step 1: Edit non-goals**

Replace:

> Moving live token/delta **streaming** onto PubSub (deltas still go to the originating socket, as today). Only lifecycle/status is PubSub+DB.

With:

> ~~(superseded 2026-07-09)~~ Live token/tool streaming for durable threads is PubSub-fanned; see `2026-07-09-assistant-live-turn-resilience-design.md`. Lifecycle/status remains PubSub+DB.

Also fix the later “Live streaming keeps originating socket” bullet the same way.

- [ ] **Step 2: Run broader verification**

```bash
cd elixir && mix test test/symphony_elixir/assistant/ test/symphony_elixir_web/channels/assistant_channel_test.exs test/symphony_elixir/agent/
cd tracker && npm test -- src/components/assistant/__tests__/WorkingIndicator.test.tsx src/services/phoenix/__tests__/assistantChannel.test.tsx
```

- [ ] **Step 3: Commit docs + any leftover wiring**

```bash
git commit -m "$(cat <<'EOF'
docs(assistant): supersede socket-only streaming non-goal

Summary:
- Point turn-session-tracking design at live-turn resilience PubSub fan-out.

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|------------------|------|
| PubSub fan-out all durable turns | 3 |
| Mid-turn `active_tools` + `last_activity_at` | 2, 3 |
| Join restores snapshot | 8 (hydrate) |
| Shared stop/kill contract (Codex primary; Claude/Cursor/OpenCode same) | 4, 5, 6 |
| Stop turn kills/interrupts agent process | 4, 5 |
| Kill command best-effort + fallback | 4, 6, 8 |
| Working strip shows command | 8 |
| Expand running Bash/shell | 9 |
| Rename CodexSession → AgentSession | 1 |
| Amend 2026-06-21 non-goal | 10 |
| No auto-resume / no auto-kill | honored (no tasks add them) |
| Orphan honesty on interrupted join | 8 (only show running when status running) |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-assistant-live-turn-resilience-plan.md`.

Documents:
- Spec: `docs/superpowers/specs/2026-07-09-assistant-live-turn-resilience-design.md`
- Plan: `docs/superpowers/plans/2026-07-09-assistant-live-turn-resilience-plan.md`

**Two execution options:**

1. **Task-per-session (recommended)** — One plan task per subagent/focus, review between tasks.
2. **Inline** — Run tasks in this chat with checkpoints after each task.

Which approach?
