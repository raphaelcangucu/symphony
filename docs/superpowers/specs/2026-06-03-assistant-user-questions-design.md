# Assistant User Questions (AskUserQuestion-style) — Design

- **Date:** 2026-06-03
- **Status:** Approved (pending spec review)
- **Author:** Symphony agent + raphaelcangucu
- **Related:** `docs/superpowers/specs/2026-05-30-tracker-global-assistant-design.md`, `docs/superpowers/specs/2026-05-31-issue-authoring-assistant-design.md`, `docs/superpowers/specs/2026-06-02-assistant-chat-steering-queue-design.md`

## Problem

When a Symphony assistant turn needs information from the user mid-flight, it
cannot ask interactively. The Codex app-server already emits a structured
`item/tool/requestUserInput` request (with `questions` carrying `header`,
`question`, `options[]`, `isOther`, `isSecret`), but the assistant path
**never surfaces it**:

- `SymphonyElixir.Codex.CodingAgent` either auto-answers approval-style
  requests, or replies with the fixed string
  `"This is a non-interactive session. Operator input is unavailable."`, or
  fails the turn with `{:turn_input_required, payload}`.
- There is **no** channel event, no UI component, and no persistence for
  agent→user structured questions anywhere in `elixir/lib/symphony_elixir/assistant/*`
  or `tracker/`.

The result: clarifying questions are flattened into free-text markdown prompts
(unstructured) or silently auto-answered, instead of the grouped multiple-choice
experience seen in Cursor / Claude Code's AskUserQuestion.

## Goals

- An assistant turn can **pause**, present structured clarifying questions, and
  **resume** with the user's answers — across all assistant scopes
  (`project`, `project_explore`, `freeform`, `issue`).
- Reuse the **native Codex `requestUserInput` protocol** as the trigger (the
  model decides when to ask), wiring it through channel → UI → back.
- Render a card matching the Codex schema: **multiple questions as tabs**,
  **single-select (radio)** options with **descriptions**, and an **"Other"**
  free-text field when `isOther` is set.
- **Persist** the asked questions + chosen answers in the thread history.
- Keep the existing **tool/MCP approval** auto-answer behavior unchanged.

## Non-Goals

- **Multi-select** per question. The Codex `requestUserInput` schema has no
  per-question multi-select flag; v1 is single-select. (The answer envelope is a
  list, so multi-select can be added later without a protocol change.)
- **Secret inputs** (`isSecret`). Rare in assistant chat; v1 renders them as a
  normal text input.
- **Resilience** for the paused turn: cancel button, surviving refresh /
  reconnection, and timeouts are out of scope for v1 (happy path only).
- Changing the **orchestrator** (non-interactive) behavior. Orchestrator runs
  keep failing/auto-answering as today (`SPEC.md` §10.5).
- A new Symphony-native `ask_user_questions` dynamic tool (rejected — see below).

## Approach (chosen)

Unlock the **native Codex `requestUserInput` protocol** for assistant turns.
When Codex sends a non-approval `requestUserInput` and the turn is flagged
**interactive**, `CodingAgent` emits a `:user_input_required` event and
**defers the JSON-RPC reply** (does not answer the port). The
`AssistantChannel` pushes the questions to the UI, the user answers via a pinned
card, and the channel sends the answers to the running turn process — symmetric
to the existing **steering** mechanism (`{:codex_steer, ...}` → `turn_pid`).
`CodingAgent` then replies to the port and the turn continues.

### Considered alternatives

- **Symphony-native `ask_user_questions` dynamic tool:** explicit schema, works
  even if the model doesn't emit `requestUserInput`. Rejected — duplicates the
  Codex schema, requires blocking a tool executor, and the model already emits
  the native protocol. The native path is closer to Cursor/Claude Code.
- **Surface all `requestUserInput` (including approvals):** more transparent but
  changes the current auto-approval security flow and adds friction. Rejected —
  v1 only surfaces non-approval clarifying questions.
- **Prompt-only ("ask in markdown"):** already how it works today; unstructured,
  no grouped multiple-choice UI. Rejected — that is the status quo we're fixing.

## Codex protocol reference (observed)

From `elixir/test/symphony_elixir/app_server_test.exs` fixtures, a request is:

```json
{
  "id": 110,
  "method": "item/tool/requestUserInput",
  "params": {
    "itemId": "call-717",
    "threadId": "thread-717",
    "turnId": "turn-717",
    "questions": [
      {
        "id": "options-719",
        "header": "Choose an action",
        "question": "How should I proceed?",
        "isOther": false,
        "isSecret": false,
        "options": [
          { "label": "Use default", "description": "Use the default behavior." },
          { "label": "Skip", "description": "Skip this step." }
        ]
      }
    ]
  }
}
```

- `options` may be `null` → **freeform** (text answer only).
- Reply shape (already used by the auto-answer path):
  `%{"id" => <request_id>, "result" => %{"answers" => %{<question_id> => %{"answers" => [<label_or_text>]}}}}`.

## Classification: approval vs clarifying question

In `CodingAgent`, a `requestUserInput` is an **approval** iff
`tool_request_user_input_approval_answers/1` returns `{:ok, _, _}` (the existing
heuristic that detects Approve/Deny/Session-style options). Otherwise it is a
**clarifying question**.

| Case | `auto_approve_requests` | interactive? | Behavior |
|------|--------------------------|--------------|----------|
| Approval | true | any | Auto-answer (unchanged) |
| Approval | false | any | `:approval_required` / non-interactive (unchanged) |
| Clarifying | any | **true** | **Emit `:user_input_required`, defer reply** (new) |
| Clarifying | any | false | Non-interactive answer / `:input_required` (unchanged, orchestrator) |

`interactive?` is a new flag set **only** by the assistant path.

## Components & Data Flow

```
Codex --(requestUserInput id=N)--> CodingAgent.receive_loop
  approval?  --yes--> auto-answer (unchanged)
             --no, interactive?--> emit :user_input_required (DEFER reply)
CodingAgent --on_message--> CodexSession.relay_codex_event
  --on_user_input_required--> AssistantChannel (send to channel pid)
AssistantChannel --push "user_input_required" {request_id, questions}--> UI
UserQuestionsCard (pinned) --submit--> channel.push "submit_user_input" {request_id, answers}
AssistantChannel --send(turn_pid, {:codex_user_input, request_id, answers, self()})--> CodingAgent.receive_loop
  send_message(port, %{"id" => request_id, "result" => %{"answers" => answers}})
AssistantChannel handle_info({:user_input_ok, request_id}) --> persist Q&A in history
```

### A. `CodingAgent` — defer + resume

File: `elixir/lib/symphony_elixir/codex/coding_agent.ex`

- Thread a new `interactive_user_input` boolean through `turn_ctx` (default
  `false`; `true` only from the assistant path).
- `maybe_auto_answer_tool_request_user_input/*`: when the request is **not** an
  approval and `interactive_user_input` is true, emit
  `emit_message(on_message, :user_input_required, %{request_id: id, item_id: params["itemId"], questions: params["questions"]}, metadata)` and return a new
  status `:awaiting_user_input` **without** sending any port reply. Track the
  pending id in `turn_ctx` (e.g. `pending_user_input` set) for validation.
- `handle_incoming/*`: map `:awaiting_user_input` to "continue the
  `receive_loop`, no error" (parallel to `:approved`); only orchestrator's
  `:input_required` keeps producing `{:error, {:turn_input_required, payload}}`.
- `receive_loop/*`: new clause
  `{:codex_user_input, request_id, answers, reply_to}` →
  `send_message(port, %{"id" => request_id, "result" => %{"answers" => answers}})`,
  `send(reply_to, {:user_input_ok, request_id})`, drop pending id, continue loop.
  `answers` arrives already in Codex shape (`%{qid => %{"answers" => [..]}}`),
  normalized by the channel.

### B. `CodexSession` — relay event

File: `elixir/lib/symphony_elixir/assistant/codex_session.ex`

- In `relay_codex_event/3`, add a branch for
  `Map.get(message, :event) == :user_input_required` →
  `maybe_call(opts, :on_user_input_required, %{request_id, item_id, questions})`,
  mirroring `on_tool_call_started`.
- Plumb `interactive_user_input: true` and `on_user_input_required` through the
  opts passed to `CodingAgent.run_turn` for `run_codex_turn`, `run_issue_turn`,
  and the freeform path.

### C. `AssistantChannel` — push + submit + persist

File: `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`

- When starting a turn (where `turn_pid` is assigned today), pass
  `interactive_user_input: true` and an `on_user_input_required` callback that
  `send`s the payload to the **channel pid** (`self()` of the channel), so the
  channel (not the turn task) does the socket `push`.
- `handle_info({:assistant_user_input_required, %{request_id, item_id, questions}}, socket)`:
  store `questions` keyed by `request_id` in assigns (needed for persistence),
  then `push(socket, "user_input_required", %{request_id, questions})`.
- `handle_in("submit_user_input", %{"request_id" => rid, "answers" => answers}, socket)`:
  - Guard: turn running + `is_pid(turn_pid)` (same guard as `steer_turn`); else
    `{:reply, :error, socket}`.
  - Normalize the client answers into Codex shape
    `%{qid => %{"answers" => [label_or_text]}}` (single-element list per
    question in v1).
  - `send(turn_pid, {:codex_user_input, rid, normalized, self()})`,
    `{:reply, :ok, socket}`.
- `handle_info({:user_input_ok, rid}, socket)`: persist via
  `History.append_message(thread, %{role: "user", content: <summary>, metadata: %{"kind" => "user_questions", "request_id" => rid, "questions" => questions, "answers" => answers}})`,
  then clear the stored entry. `<summary>` is a human-readable rendering so
  plain-text history readers still see the Q&A.

### D. Channel client + types

Files: `tracker/src/services/phoenix/assistantChannel.ts`,
`tracker/src/services/assistant.ts`

- Bind `user_input_required` → callback with `{ requestId, questions }`.
- Add `submitUserInput(requestId, answers)` → `channel.push("submit_user_input", { request_id, answers })`.
- Types:
  - `UserQuestionOption { label: string; description?: string }`
  - `UserQuestion { id: string; header: string; question: string; isOther: boolean; isSecret: boolean; options: UserQuestionOption[] | null }`
  - `UserQuestionsRequest { requestId: string; questions: UserQuestion[] }`
  - `UserQuestionAnswer` (per-question selected label or free text).

### E. `UserQuestionsCard` component

File (new): `tracker/src/components/assistant/UserQuestionsCard.tsx`

- Rendered **pinned above the composer**; disappears once submitted (or when the
  turn completes/errors).
- Tabs: one per question (single question → no tab chrome needed).
- Per question:
  - `header` (title) + `question` (body text).
  - `options[]` as **radio** controls (label + `description` subtext).
  - If `isOther`, an extra "Other" radio that reveals a free-text `input`.
  - If `options == null` (freeform), render only a free-text `input`.
- Single **"Submit answers"** button, disabled until every question has an
  answer (selected option, or non-empty Other/freeform text). On click →
  `submitUserInput(requestId, answers)`.
- Visual style mirrors existing assistant cards (`ToolCallSummary`) and the
  `/admin` whitelabel conventions; reuse existing UI primitives.

### F. Panel integration + history rendering

Files: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`,
`FreeformAssistantPanel.tsx`, `IssueAuthoringPanel.tsx`

- Hold `pendingQuestions: UserQuestionsRequest | null` state, set on
  `user_input_required`, cleared on submit and on `assistant_completed` /
  `assistant_error`.
- Render `<UserQuestionsCard>` pinned above the composer when present.
- On history load, render persisted messages with
  `metadata.kind === "user_questions"` as a compact **read-only** card (questions
  + chosen answers), so reopening a thread shows what was asked/answered.
- Composer behavior is unchanged from today's running-turn behavior (existing
  steering/queue semantics); the card is the answer path.

## Error Handling

- `submit_user_input` with no running turn / invalid `turn_pid` →
  `{:reply, :error}` (same as `steer_turn`).
- Unknown / stale `request_id` → log and ignore (no crash).
- `isSecret == true` (unsupported v1) → render a normal text input; no masking.
- Malformed `questions` payload (missing `id`) → CodingAgent falls back to the
  existing non-interactive answer rather than deferring forever.
- If the turn ends while a card is pending (process died), the UI clears the
  card on `assistant_error` (no resume in v1).

## Testing

Elixir:
- `app_server_test.exs`: extend the existing `requestUserInput` fixtures
  (approval / freeform / options). New interactive case: a non-approval request
  with `interactive_user_input: true` emits `:user_input_required` (assert via a
  capturing `on_message`) and **does not** auto-reply; sending
  `{:codex_user_input, id, answers, self()}` to the turn writes the Codex reply
  to the port and the turn completes. Approval fixture still auto-answers.
- `assistant_channel_test.exs`: `submit_user_input` guards (no turn → `:error`),
  normalization to Codex shape, `send` to `turn_pid`, and persistence of a
  `kind: "user_questions"` message on `{:user_input_ok, _}`.

Frontend:
- `UserQuestionsCard.test.tsx`: renders tabs/radio/descriptions, "Other" reveals
  free-text, freeform (`options: null`) renders text input, submit disabled
  until answered, submit calls `submitUserInput` with the right shape.
- Panel integration: card appears on `user_input_required`, clears on submit,
  persisted Q&A renders read-only in history.

Gates: `make all` (format, lint, coverage, dialyzer), `mix specs.check`;
frontend lint/test per `tracker/` conventions.

## Open Questions

- None blocking. "Other"/freeform answers are sent as the question's single
  answer label (text). If Codex later signals multi-select, the list envelope
  already supports it without a protocol change.
