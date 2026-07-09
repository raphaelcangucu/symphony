# Claude AskUserQuestion via PreToolUse — Design

- **Date:** 2026-07-09
- **Status:** Draft (awaiting user review)
- **Author:** Symphony agent + raphaelcangucu
- **Related:**
  - `docs/superpowers/specs/2026-06-03-assistant-user-questions-design.md` (Codex interactive path — already shipped)
  - Incident: workspace thread `7999` / turn `77281ddb-…` where Claude `AskUserQuestion` completed as `status: "error"`, output `"Answer questions?"`, and the UI showed raw JSON with **FALHOU** instead of `UserQuestionsCard`

## Problem

Codex assistant turns already pause on clarifying questions via native
`item/tool/requestUserInput` → `:user_input_required` → `UserQuestionsCard` →
`submit_user_input` → port reply.

Claude assistant turns do **not**. Claude Code’s native `AskUserQuestion` tool
runs inside the `claude --print` subprocess. In Symphony’s headless path it has
no TTY, so the tool fails immediately (`"Answer questions?"`), the timeline
renders a failed tool chip with the question JSON, and the turn continues or
finishes without ever pushing `user_input_required`.

Observed on thread `7999` (Claude Opus 4.8, `execution_mode: yolo`):

1. `20:35:12` — `AskUserQuestion` enters `active_tools` with header `"Alvo do teste"`.
2. ~4 ms later — removed from `active_tools`.
3. Persisted tool call: `status: "error"`, `output: "Answer questions?"`.
4. Turn `completed` at `20:35:25` with no interactive card.

## Goals

- Interactive Claude assistant turns (`interactive_user_input: true`) **pause**
  on `AskUserQuestion`, show the **same** `UserQuestionsCard` as Codex, accept
  answers via `submit_user_input`, and **resume** the in-flight CLI turn.
- Reuse the existing channel contract (`user_input_required` /
  `submit_user_input`) and history persistence (`metadata.kind: "user_questions"`).
- Keep Codex’s `requestUserInput` path unchanged.
- Keep Claude tool-approval (`symphony_approve` / `ApprovalBroker`) unchanged.
- Orchestrator / non-interactive Claude turns must **not** hang waiting for a
  card.

## Non-Goals

- **Cursor** in this change. Cursor CLI does not fire `preToolUse` /
  `postToolUse` for `AskQuestion` (confirmed upstream bug), and headless
  `--print` fabricates `"Questions skipped by the user, continue with the
  information you already have"` — a distinct safety follow-up. Document only.
- Changing the Codex protocol or inventing a Symphony-native
  `ask_user_questions` dynamic tool (already rejected in the June design).
- Mid-pause resilience (refresh/reconnect while the card is open, cancel
  button, rich timeout UX) — same v1 stance as the June Codex design.
- Multi-select UX expansion beyond what `UserQuestionsCard` already supports.

## Approach (chosen)

Use Claude Code’s documented **PreToolUse** interception for `AskUserQuestion`
(v2.1.85+):

- Matcher: `AskUserQuestion`
- On interactive turns: block in a Symphony-owned hook command until the
  operator answers, then return
  `permissionDecision: "allow"` + `updatedInput` with the original `questions`
  array and an `answers` map (question text → chosen label / free text).
- Prefer **synchronous `allow` + `updatedInput`** over `defer` + `--resume`
  so the CLI process stays alive (mirrors how `ApprovalBroker` blocks without
  tearing down the session).

### Why not MCP `ask_user` (approach 1)

Earlier brainstorming considered replacing the native tool with an MCP tool.
That works and reuses `ToolGateway`, but the user chose PreToolUse so Claude
keeps calling the **native** `AskUserQuestion` tool (schema + model training
alignment) while Symphony owns only the headless answer surface.

### Why not Cursor in the same PR

Hooks do not cover `AskQuestion` today; headless fabricates a skip. Shipping a
false “standardized” Cursor path would reintroduce silent proceed-on-skip.
Cursor is explicitly deferred.

## Claude PreToolUse reference (observed / documented)

From Claude Code hooks docs (v2.1.85+ / issue #39620 verification):

- `PreToolUse` matches `AskUserQuestion`.
- To satisfy programmatically in `-p` mode, return:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "questions": [/* echo original tool_input.questions */],
      "answers": {
        "<question text>": "<selected label or free text>"
      }
    }
  }
}
```

- Multi-select labels in `answers` are comma-joined (if Claude emits
  `multiSelect: true`). Symphony maps those into the existing card contract.

## Architecture

```
claude CLI --print
  └── PreToolUse matcher=AskUserQuestion
        └── Symphony hook command (session-scoped --settings)
              ├── parse stdin tool_input.questions
              ├── POST/await UserInputBroker (local HTTP / internal route)
              │     └── emit :user_input_required → AssistantChannel → UserQuestionsCard
              ├── operator submit_user_input → UserInputBroker.resolve
              └── stdout allow + updatedInput{questions, answers}
claude continues turn
```

Codex stays on the existing port path:

```
Codex requestUserInput → :user_input_required → card → {:codex_user_input} → port reply
```

Shared UI/channel; agent-specific **answer delivery**.

## Components

### A. `SymphonyElixir.Assistant.UserInputBroker`

Two layers, same idea as `ApprovalBroker` but reachable from an external hook:

1. **In-BEAM registry** (Elixir): keyed by opaque `request_id`.
   - `await/2` / `resolve/2` with timeout (~300s, configurable).
   - Timeout → `{:error, :timeout}` so the hook denies instead of hanging.
2. **Loopback HTTP façade** (daemon): PreToolUse is an **external OS process**
   (unlike MCP `symphony_approve`, which runs inside `ToolGateway`). The hook
   cannot `send/2` into the BEAM, so it calls loopback-only HTTP with a
   short-lived per-session token written into hook settings/env.
   - Sketch: `POST /internal/assistant/user-input/await` with
     `{request_id, questions, session_token}` long-polls until answers.
   - That handler looks up the live assistant turn/channel by session token,
     emits `:user_input_required` (card appears), then blocks on the registry
     until `submit_user_input` → `resolve/2`.

Exact route vs reuse of an existing listener is an implementation-plan detail
(see open notes).

### B. Session-scoped Claude settings / hook install

When `interactive_user_input: true` on a Claude assistant turn:

1. Write a temp `--settings` JSON (or merge into the session settings file) with
   a `PreToolUse` hook matching `AskUserQuestion`, command pointing at a
   Symphony-owned hook runner script/binary.
2. Pass `--settings <path>` from `CliRunner.build_args/1`.
3. Env/config for the hook includes the session token + base URL for the broker.
4. Clean up settings/token on session stop (same lifecycle as MCP config).

When `interactive_user_input: false` (orchestrator):

- Do **not** install the interactive hook, **or** install a non-interactive
  variant that immediately returns deny / a fixed “operator input unavailable”
  style answer without emitting a card. Prefer deny-or-explicit-error so Claude
  does not invent answers (contrast Cursor’s fabricated-skip bug). Exact non-
  interactive payload is fixed in the implementation plan after a one-turn CLI
  fixture.

### C. Question normalizer

Map Claude `AskUserQuestion` `tool_input.questions` into the Codex-shaped
array already consumed by `normalizeUserQuestionsRequest` /

`UserQuestionsCard`:

| Claude field | Symphony / Codex field |
|--------------|------------------------|
| (index or generated) | `id` (stable string per question for the card) |
| `header` | `header` |
| `question` | `question` |
| `options[].label` / `description` | `options[].label` / `description` |
| `multiSelect` | carried in metadata if needed; v1 card remains single-select unless already multi-capable |
| (n/a) | `isOther` / `isSecret` default false unless present |

Also build the reverse map needed for PreToolUse `answers`:
`question_text → chosen label` from the card’s Codex-shaped
`%{qid => %{"answers" => [label]}}` submit payload.

### D. `AssistantChannel` answer routing

Today `submit_user_input` always `send(turn_pid, {:codex_user_input, ...})`.

Change to agent-aware delivery:

- `"codex"` → existing `{:codex_user_input, request_id, answers, reply_to}`
- `"claude"` → `UserInputBroker.resolve(request_id, answers)` (+ ack to channel
  for history persistence, same as today’s `user_input_ok` path)
- `"cursor"` → no-op / error in this change (out of scope)

Keep persistence via `maybe_persist_user_questions/3` after successful resolve.

### E. Timeline / failed chip

Once PreToolUse successfully answers, Claude should emit a successful
`AskUserQuestion` tool_result (not `"Answer questions?"`). That alone removes
the **FALHOU** chip for the happy path.

If a tool_call chip still appears briefly as “running”, that is acceptable.
Do **not** special-case hide failed historical chips from thread `7999` in this
change.

### F. Frontend

No UI component changes required for v1. Existing
`UserQuestionsCard` / `user_input_required` / `submitUserInput` contract stays.

## Behavior matrix

| Agent | Interactive assistant turn | Non-interactive / orchestrator |
|-------|----------------------------|--------------------------------|
| Codex | Unchanged: `requestUserInput` → card | Unchanged: auto non-interactive string / attention |
| Claude | PreToolUse → broker → card → allow+updatedInput | No card; deny or explicit error (no fabricated consent) |
| Cursor | Out of scope (document follow-up) | Out of scope |

## Testing

- **Unit:** `UserInputBroker` resolve / timeout; Claude→Codex question normalizer;
  answers reverse-map for `updatedInput`.
- **Channel:** `submit_user_input` with Claude agent resolves broker; Codex path
  regression.
- **Claude adapter / hook runner:** fixture stdin `AskUserQuestion` PreToolUse
  event → emits await → after resolve, stdout contains `permissionDecision:
  allow` and `answers`.
- **Non-interactive:** hook or absent-hook path does not push
  `user_input_required`.

Manual check: reproduce thread-7999 style ask on Claude in tracker and confirm
card → answer → turn continues without **FALHOU**.

## Cursor follow-up (documentation only)

Cursor gaps to track separately:

1. `AskQuestion` does not fire CLI/IDE `preToolUse` / `postToolUse` (upstream
   bug).
2. Headless `--print` may fabricate `"Questions skipped by the user…"` with
   `is_error=false`, which is unsafe if treated as consent.
3. Likely future path: MCP `ask_user` or ACP `cursor/ask_question` once available;
   until then, prefer text questions for Cursor assistant turns.

## Open implementation notes (resolve in the plan, not blockers)

1. Exact loopback route/auth for the hook ↔ broker IPC (reuse ToolGateway listener
   vs dedicated Phoenix pipeline).
2. Exact non-interactive PreToolUse response body Claude accepts when denying.
3. Where to ship the hook runner binary/script (repo path under `elixir/` vs
   generated temp script per session).

## Success criteria

1. Claude interactive turn that calls `AskUserQuestion` shows `UserQuestionsCard`
   and does not show a failed `"Answer questions?"` chip on the happy path.
2. Submitting answers resumes the same Claude turn; answers land in history as
   `kind: user_questions`.
3. Codex interactive questions still work.
4. Claude approvals (`symphony_approve`) still work.
5. Orchestrator Claude turns never open a card for `AskUserQuestion`.
6. Spec explicitly lists Cursor as follow-up, not pretended support.
