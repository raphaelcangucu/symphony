# Assistant Chat: Queued Messages, Working Animation, `/infer` Steering, and `/btw` Side Questions

- **Date:** 2026-06-02
- **Status:** Draft (awaiting user review)
- **Area:** Issue/Project assistant chat (`tracker/` React SPA + `elixir/` Phoenix channel + Codex app-server)
- **Entry point:** `http://localhost:4000/tracker/projects/:project/assistant/issue/:id`

## 1. Summary

Four user-facing improvements to the assistant chat, plus one backend foundation that two
of them depend on:

1. **Working animation** — replace the static `Assistant is working...` line with an animated
   indicator (spinner + rotating verbs + elapsed timer + active tool name), in the style of
   Claude Code / Codex.
2. **Queued messages** — let the user type and submit while the assistant is running; messages
   queue locally and auto-send when the current turn finishes (Cursor-style).
3. **Backend foundation** — move turn execution off the channel process so the channel stays
   responsive mid-turn. Prerequisite for `/infer` and `/btw`.
4. **`/infer` steering** — inject the user's text into the *in-flight* Codex turn via the
   app-server `turn/steer` method, redirecting the running agent without starting a new turn.
5. **`/btw` side question** — an ephemeral, read-only, no-tool, one-shot side query answered in a
   floating overlay; it does not interrupt the main turn and is never persisted to history.

These ship as a single spec but are independently shippable in the order above.

## 2. Background and current architecture

The chat is a **React SPA** under `tracker/`, wired to Phoenix over a **WebSocket channel**
(`assistant:*`). Relevant files:

| Concern | Path |
|---------|------|
| Chat + streaming UI | `tracker/src/components/assistant/ProjectAssistantPanel.tsx` |
| Composer (textarea/model/effort/voice/images) | `tracker/src/components/assistant/AssistantComposer.tsx` |
| Channel client bindings | `tracker/src/services/phoenix/assistantChannel.ts` |
| Channel server | `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` |
| Turn orchestration | `elixir/lib/symphony_elixir/assistant/codex_session.ex` |
| Codex app-server client | `elixir/lib/symphony_elixir/codex/coding_agent.ex` |
| Persistence | `elixir/lib/symphony_elixir/assistant/history.ex` |

**Current turn lifecycle (synchronous, blocking):**

`handle_in("send_message")` (`assistant_channel.ex:80`) → `CodexSession.send_message_to_issue_thread/4`
→ `CodingAgent.start_session` → `CodingAgent.run_turn` → `receive_loop` (`coding_agent.ex:486`),
a blocking selective `receive` on the Codex port, until `turn/completed`/`failed`/`cancelled` →
`stop_session`. The turn runs **inside the channel process**, so while it runs the channel cannot
process any other inbound push.

**Busy state:** React `isRunning` in `ProjectAssistantPanel.tsx:96`. Set true on send (`:331`) and
first `assistant_delta` (`:179`); cleared on `assistant_completed` (`:186`) / `assistant_error`
(`:193`). Rendered at `:396`. The composer is **disabled** while running (`:405`), and `sendMessage`
**drops** anything submitted while running (`:311`).

**Codex app-server protocol** (`codex app-server`, JSON-RPC 2.0 over stdio) supports:

- `turn/start` → returns `{ turn: { id } }`, streams `item/*` and `turn/completed`.
- `turn/steer` → "add user input to an already in-flight regular turn without starting a new turn";
  params `{ threadId, input: [{type:"text", text}], expectedTurnId, clientUserMessageId? }`;
  returns `{ turnId }`. **`expectedTurnId` is required.** Fails with `ActiveTurnNotSteerable` /
  invalid request when there is no active turn, the id mismatches, or the turn kind is review/compaction.
- `turn/interrupt` → cancels an in-flight turn; turn ends with `status: "interrupted"`.
- `thread/fork` with `ephemeral: true` → in-memory temporary fork sharing context.

`start_turn/8` already captures the active `turn_id` from the `turn/start` response
(`coding_agent.ex:477`), so `expectedTurnId` is available.

## 3. Goals and non-goals

**Goals**

- Animated working indicator that conveys liveliness and the active operation.
- Allow enqueuing messages while busy; auto-send sequentially.
- True mid-turn steering via `turn/steer` for `/infer`, with a graceful fallback to queue.
- Ephemeral `/btw` side answers in an overlay, never persisted, no tools.
- Slash-command palette in the composer for discoverability.

**Non-goals**

- Multiple concurrent main turns per thread (still one main turn at a time; the queue serializes).
- Persisting `/btw` exchanges or feeding them back into the main context.
- Steering review/compaction turns (protocol rejects it; treated as fallback-to-queue).
- Reworking voice/image attachment flows.
- Changing the freeform/project (non-issue) chat behavior beyond what is shared with the issue chat.

## 4. Slash-command UX (shared)

- Parsing happens in `AssistantComposer`. A trimmed input whose first token is `/infer` or `/btw`
  is a command; the remainder (after the first space) is the argument text.
- **Palette:** typing `/` as the first character opens a small autocomplete popover above the
  textarea listing `/infer` and `/btw` with one-line descriptions. ↑/↓ to move, Enter/Tab/click to
  complete the command token; Esc closes the palette. Typing the full command manually also works.
- Commands are submitted with the same Enter key as normal messages. The submit payload carries a
  discriminated `kind`: `"message" | "infer" | "btw"`.
- Unknown `/foo` is treated as a normal message (no special handling), so users are never blocked.

### Composer submit contract (new)

`AssistantComposerSubmit` gains a `kind` field:

```ts
type AssistantComposerSubmitKind = "message" | "infer" | "btw";

interface AssistantComposerSubmit {
  kind: AssistantComposerSubmitKind;
  message: string;       // argument text (command token stripped for infer/btw)
  settings: AssistantComposerSettings;
  attachments: ReturnType<typeof serializeAttachments>;
}
```

## 5. Feature 1 — Working animation

**Component:** new `tracker/src/components/assistant/WorkingIndicator.tsx`.

**Props:** `{ startedAt: number; activeTool?: string | null }`.

**Behavior**

- Renders a small spinner (lucide `Loader2` with `animate-spin`, or a dots/braille animation) +
  a label + an elapsed timer (`· 0:14`, `m:ss`, updated every 1s via an interval).
- Label logic:
  - If `activeTool` is set, label = `Running <tool>…` (e.g. `Running update_issue…`).
  - Otherwise, a verb rotates every ~3s from a curated list:
    `Pondering`, `Cooking`, `Wrangling tokens`, `Consulting the codex`, `Untangling threads`,
    `Spelunking the repo`, `Composing`, `Crunching`, `Plotting`. (Final list refined in implementation.)
- `prefers-reduced-motion`: no spinner rotation and no verb rotation; show a single static verb +
  the timer. Implemented via a `useReducedMotion`-style check (CSS `motion-safe:`/`motion-reduce:`
  utilities for the spinner; a JS media-query guard for the verb interval).
- Verb rotation and timer use a single mounted-lifetime interval set; cleared on unmount.

**Integration**

- In `ProjectAssistantPanel`, track `runningStartedAt: number | null` (set when `isRunning`
  transitions to true, cleared when it returns to false) and derive `activeTool` from the current
  streaming message's last running tool call (`STREAMING_ASSISTANT_ID` message, `toolCalls` with
  `status === "running"`).
- Replace the `:396` line with `{isRunning ? <WorkingIndicator startedAt={runningStartedAt} activeTool={activeTool} /> : null}`.

**No backend changes.**

## 6. Feature 2 — Queued messages

**State (in `ProjectAssistantPanel`):**

```ts
interface QueuedMessage {
  id: string;                         // crypto.randomUUID()
  payload: AssistantComposerSubmit;   // kind === "message"
}
const [queued, setQueued] = useState<QueuedMessage[]>([]);
```

**Composer:** remove `disabled={isRunning}`. The composer stays interactive while running. (Voice
recording / image upload disabled flags are unchanged.)

**Submit routing in `sendMessage` (kind === "message"):**

- If **not** running: send immediately (current behavior).
- If running: push to `queued` instead of sending. Do not set `isRunning` (already true).

**Drain:** when `isRunning` transitions to false (driven by `assistant_completed` /
`assistant_error`), if `queued` is non-empty, `shift` the first item and send it. Use a small
effect keyed on `isRunning` + `queued.length`, guarded so it only fires on the running→idle edge.

**UI:** a stack of "pending" chips rendered between the message list and the composer:

- Each chip shows the queued text (truncated) and an X to remove it (`setQueued(filter)`).
- Chips have a subtle "queued" affordance (muted background, clock icon).

**Server safety net:** add a per-channel running guard. `handle_in("send_message")` returns
`{:reply, {:error, %{reason: "assistant is busy"}}, socket}` if `socket.assigns[:turn_status] == :running`.
This is defensive; the frontend serializes so it should not normally trigger. (Status assign is
introduced by Feature 3.)

**Interaction with commands:** `/infer` and `/btw` submitted while running are **not** queued —
they are handled live (Features 4 and 5). Only `kind === "message"` queues.

## 7. Feature 3 — Backend foundation: turn off the channel process

**Problem:** the channel process blocks in `receive_loop` during a turn, so it cannot receive a
`steer_turn`/`btw` push mid-turn.

**Design:** run each main turn in a **monitored `Task`** that owns the Codex port.

### 7.1 Channel changes (`assistant_channel.ex`)

- `handle_in("send_message")` validates as today, then **spawns a Task** (via a supervised
  `Task.Supervisor`, e.g. `SymphonyElixir.Assistant.TurnSupervisor`) running the existing
  `run_send_turn/5` pipeline. It stores in socket assigns:
  `turn_status: :running`, `turn_task_ref: ref` (from `Process.monitor`/`Task.async`),
  `turn_pid: pid`, `codex_thread_id`, `codex_turn_id: nil` (filled in when known).
  Returns `{:reply, :ok, socket}` immediately (no longer blocks).
- The streaming callbacks (`on_message_created`, `on_assistant_delta`, `on_tool_call_*`,
  `on_documents_changed`) continue to `push/3` to the socket. `Phoenix.Channel.push/3` targets
  `socket.transport_pid` and is safe to call from the Task (the Task is given the socket / a push
  function closure). **Validation step in the plan:** confirm `push/3` from a non-channel process
  delivers correctly in this app; if not, route events back through the channel process via
  `send(channel_pid, {:assistant_event, ...})` + a `handle_info` that pushes.
- Channel learns the active `codex_turn_id`: `CodingAgent`/`CodexSession` emits a
  `:turn_started` event carrying `{thread_id, turn_id}` (already emitted as `:session_started`
  internally; expose it through the runner callbacks). The channel stores it in assigns so steering
  can pass `expectedTurnId`.
- New `handle_info`:
  - `{:DOWN, ref, :process, _pid, reason}` for `turn_task_ref` → if the Task died abnormally and we
    have not already pushed completion, push `assistant_error` and reset `turn_status: :idle`.
  - `{:turn_finished, result_or_error}` (sent by the Task on normal completion) → push
    `assistant_completed`/`assistant_error`, run the existing created-issue migration, reset status.
- Concurrency guard: a second `send_message` while `:running` is rejected (Feature 2 safety net).

### 7.2 `CodingAgent` changes (`coding_agent.ex`) — steer-aware receive loop

- Thread the active `turn_id` and a `steer_sink_pid` (the Task's own pid, since `receive_loop`
  runs in the Task) into `receive_loop`.
- Extend `receive_loop` to also match Elixir messages:
  - `{:codex_steer, input, reply_to}` → write `turn/steer` to the port with
    `{threadId, input, expectedTurnId: turn_id, clientUserMessageId}` using a fresh incrementing
    JSON-RPC id; record the pending steer id so its `{id, result|error}` response can be matched and
    forwarded to `reply_to` (`{:steer_ok, turn_id}` / `{:steer_error, reason}`). Continue looping.
  - `{:codex_interrupt}` → write `turn/interrupt` `{threadId, turnId}`; continue looping (turn ends
    via the normal `turn/cancelled`/`turn/completed status: interrupted` path).
- JSON-RPC id allocation: replace fixed `@turn_start_id`-style constants for steer/interrupt with a
  monotonically increasing counter carried in the loop accumulator (start above the reserved
  init/thread/turn/goal ids).
- New public function `CodingAgent.steer/3` is **not** required if the Task holds the loop; instead
  the Task exposes a message API. Keep the steer/interrupt mechanism internal to the running loop,
  driven by messages from the Task.

### 7.3 `CodexSession` / Task wiring

- The Task runs `CodexSession.send_message_to_issue_thread/4` (and the project/freeform variants)
  unchanged on the surface, but `default_runner/4` now:
  - passes the Task pid as `steer_sink_pid` and the `turn_id` (once known) into `run_turn`/`receive_loop`,
  - exposes an `on_turn_started` callback so the channel learns `codex_turn_id`.
- A new lightweight API on the Task lets the channel forward steering:
  `send(turn_pid, {:codex_steer, input, channel_pid})` and `send(turn_pid, {:codex_interrupt})`.

### 7.4 Safety (per `elixir/AGENTS.md`)

- Workspace/cwd rules unchanged; the Task uses the same workspace resolution.
- One active main turn per channel enforced by `turn_status`.
- Tasks are supervised so a crash cannot leak ports; `stop_session` runs in the Task's `after`.

## 8. Feature 4 — `/infer` steering

### 8.1 Frontend

- Composer parses `/infer <text>` → submit `kind: "infer"`.
- In `ProjectAssistantPanel.sendMessage`:
  - If `kind === "infer"` and `turn_status` is running: `channel.push("steer_turn", { message, clientId })`.
    - On `ok`: optimistically append a user "steer" bubble (or rely on `message_created`).
    - On `error` with `ActiveTurnNotSteerable`/no-active-turn: fall back to enqueue as a normal
      message (Feature 2) and surface a toast ("Turn already finished — queued instead").
  - If `kind === "infer"` and **not** running: send as a normal `send_message` (the text becomes the
    next instruction). Document this default explicitly.

### 8.2 Backend

- New `handle_in("steer_turn", %{"message" => msg} = payload, socket)`:
  - Requires `turn_status: :running` and a known `codex_turn_id`; else
    `{:reply, {:error, %{reason: "ActiveTurnNotSteerable"}}, socket}`.
  - Persists the steer text as a `user` message (`metadata: %{"steer" => true}`) via `History.append_message`
    and pushes `message_created` so it renders in the transcript.
  - Forwards `send(turn_pid, {:codex_steer, [%{"type"=>"text","text"=>msg}], self()})`.
  - Receives `{:steer_ok, turn_id}` / `{:steer_error, reason}` via `handle_info`; replies/pushes
    accordingly. On `:steer_error` with a non-steerable reason, push a `steer_failed` event so the
    client can fall back to queue.

### 8.3 Rendering

- Steer user messages render as normal user bubbles (Feature: they ARE part of history). The
  streaming assistant bubble continues to update as the steered turn proceeds.

## 9. Feature 5 — `/btw` side question

### 9.1 Frontend

- Composer parses `/btw <text>` → submit `kind: "btw"`. Works whether or not a turn is running.
- `ProjectAssistantPanel` pushes `channel.push("btw", { message })` and opens a **floating overlay**
  (`tracker/src/components/assistant/BtwOverlay.tsx`): shows the question, then streams the answer.
- Overlay events: bind `btw_delta`, `btw_completed`, `btw_error` (scoped by a `btw_id` to avoid
  colliding with main-turn deltas). Dismiss on Esc, click-outside, or a close button.
- The overlay does **not** add anything to `messages`; nothing persists.

### 9.2 Backend

- New `handle_in("btw", %{"message" => msg}, socket)`:
  - Generates a `btw_id`, replies `{:reply, {:ok, %{btw_id: btw_id}}, socket}`.
  - Spawns a supervised Task running a **separate, ephemeral Codex session** (its own port) so it
    never contends with the main turn's port:
    - Build a prompt from the thread's recent history (reuse `format_history`) + a system instruction
      mirroring `/btw`: "This is a side question. Answer directly in a single response. You have NO
      tools. Do not promise actions."
    - `dynamic_tools: []`, `tool_executor` denies all, single turn.
    - Stream deltas via `push(socket, "btw_delta", %{btw_id: id, delta: ...})`; finish with
      `btw_completed`; errors with `btw_error`.
  - **Not** persisted to `History`. No issue document side effects.
- Implementation detail: a thin `CodexSession.run_ephemeral_side_query/3` (or reuse the freeform
  path with a dedicated ephemeral workspace/temp dir) that does start_session → run_turn →
  stop_session with no persistence.

### 9.3 Why a separate session (decision)

Sharing the main turn's port for a concurrent `thread/fork` would interleave two streams of
notifications on one stdio channel, which is error-prone to demux. A separate ephemeral session is
simpler and fully isolated; the cost is one extra short-lived subprocess.

## 10. Channel events summary (new/changed)

| Direction | Event | Payload |
|-----------|-------|---------|
| client→server | `steer_turn` | `{ message, clientId }` |
| client→server | `btw` | `{ message }` |
| server→client | `message_created` | (existing) also used for steer user messages |
| server→client | `steer_failed` | `{ reason }` (client falls back to queue) |
| server→client | `btw_delta` | `{ btw_id, delta }` |
| server→client | `btw_completed` | `{ btw_id, message }` |
| server→client | `btw_error` | `{ btw_id, message }` |

Existing `send_message`, `assistant_delta`, `assistant_completed`, `assistant_error`,
`tool_call_*`, `assistant_document_changed`, `assistant_issue_created` are unchanged in shape;
`assistant_completed`/`assistant_error` are now pushed from the Task path.

## 11. Error handling

- **Steer race:** turn completes between the user pressing Enter and the steer reaching the loop →
  `turn/steer` returns invalid/`ActiveTurnNotSteerable` → backend emits `steer_failed` → client
  enqueues the text as a normal message.
- **Task crash:** `{:DOWN, ...}` handler pushes `assistant_error`, resets `turn_status`, and
  `stop_session` in the Task's `after` reclaims the port.
- **`/btw` failure:** isolated to its overlay (`btw_error`); main turn unaffected.
- **Queue drain failure:** if a queued send errors, surface the error and keep remaining items
  queued (do not silently drop).
- **Reduced motion:** animation degrades to static text + timer.
- **Unknown slash command:** treated as plain message.

## 12. Testing

**Elixir**

- `coding_agent` steer-aware loop: feed a fake port that emits `turn/started`, then accepts a
  `{:codex_steer, ...}` message, verifies a `turn/steer` line is written with the correct
  `expectedTurnId`, and that the loop continues until `turn/completed`.
- `assistant_channel`:
  - `send_message` now returns immediately and the turn runs in a Task (use the configurable
    `:assistant_runner` to stub) — assert `assistant_completed` is pushed.
  - `steer_turn` persists a steer user message and forwards to the runner; `steer_failed` path on
    no active turn.
  - `btw` replies with `btw_id`, streams `btw_delta`/`btw_completed`, and does **not** persist.
  - concurrency guard rejects a second `send_message` while running.
- Keep existing tests green; mirror structure under `test/symphony_elixir_web/channels/` and
  `test/symphony_elixir/codex/`.
- Quality gate: `make all` and `mix specs.check` (public `def` in `lib/` need `@spec`).

**Frontend**

- Composer parsing: `/infer x`, `/btw x`, bare `/`, unknown `/foo`, palette navigation.
- Queue: submit while running enqueues; drain on completion sends next; remove chip.
- `WorkingIndicator`: timer increments; verb rotates; reduced-motion path renders static.
- `assistantChannel` bindings for `steer_failed`, `btw_*`.

## 13. File map

**New**

- `tracker/src/components/assistant/WorkingIndicator.tsx`
- `tracker/src/components/assistant/BtwOverlay.tsx`
- `tracker/src/components/assistant/slashCommands.ts` (parse + palette command list)
- `elixir/lib/symphony_elixir/assistant/turn_supervisor.ex` (Task.Supervisor)
- (maybe) `elixir/lib/symphony_elixir/assistant/side_query.ex` for `/btw` ephemeral runs

**Changed**

- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (queue, working indicator, steer/btw routing, overlay)
- `tracker/src/components/assistant/AssistantComposer.tsx` (no disable-while-running, slash palette, `kind`)
- `tracker/src/services/phoenix/assistantChannel.ts` (new event bindings, `steer_turn`/`btw` pushes)
- `tracker/src/lib/assistantSettings.ts` or submit types (add `kind`)
- `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (Task spawn, `steer_turn`, `btw`, guard, handle_info)
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` (turn_started callback, steer plumbing, side query)
- `elixir/lib/symphony_elixir/codex/coding_agent.ex` (steer-aware receive_loop, JSON-RPC id counter, turn/steer, turn/interrupt)
- `elixir/lib/symphony_elixir/application.ex` (start the Task.Supervisor)

## 14. Build order (independently shippable)

1. **Working animation** — frontend only, no dependencies.
2. **Queued messages** — frontend + tiny server guard (the guard can land with Feature 3).
3. **Backend foundation** — Task-based turn execution + steer-aware loop.
4. **`/infer`** — depends on 3.
5. **`/btw`** — depends on 3 (separate ephemeral session).

## 15. Open questions / risks

- **`push/3` from a Task:** must confirm Phoenix delivers channel pushes from a non-channel process
  in this app; fallback is to route via `send(channel_pid, ...)` + `handle_info`. (Resolve in the
  foundation step before building on it.)
- **Codex version:** `turn/steer` must be present in the installed `codex` binary. Add a capability
  check (from the `initialize` result) and degrade `/infer` to fallback-queue if unsupported.
- **Verb list / copy:** final wording for the working animation verbs to be confirmed during
  implementation (not behavior-affecting).
- **`/btw` workspace:** ephemeral side-query needs a cwd; use a temp dir or the issue workspace in a
  read-only posture (no tools, so no writes expected).
