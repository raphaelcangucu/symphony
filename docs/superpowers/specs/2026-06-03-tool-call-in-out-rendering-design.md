# Tool Call IN/OUT Rendering — Design

Date: 2026-06-03
Status: Approved (pending written-spec review)

## Problem

Tool calls render poorly across the tracker's two agent surfaces:

- **Assistant chat** (`ProjectAssistantPanel` → `ToolCallSummary`): each tool call
  is a tiny box showing only the tool **name** plus an optional issue row. No
  arguments, no result body. The backend only forwards a `result` summary object
  to the UI — the tool **arguments** (the "IN") and a presentable output (the
  "OUT") never reach the frontend.
- **Execution session log** (`SessionLogEntryCard`): the raw data exists
  (`tool_call` carries the command, `tool_result` carries the output) but the two
  render as **separate adjacent cards** with generic titles ("Command output"),
  not a single paired block with `IN`/`OUT` labels.

We want a single, consistent transcript-style block per tool call: a header (tool
type + short description), an `IN` section (command/arguments), and an `OUT`
section (output/result), matching the reference screenshot (a `Bash` block with
`IN` showing the command and `OUT` showing stdout).

## Goals

1. One shared `ToolCallBlock` component used by both surfaces, with identical
   look-and-feel (header + `IN` + `OUT` + status badge + truncation).
2. **Execution:** pair `tool_call` + `tool_result` into a single block by
   `call_id`. Bash commands show as `IN` (bash), stdout as `OUT`.
3. **Assistant chat:** surface real `IN` (arguments) and `OUT` (result message +
   data summary) — requires backend/channel/persistence changes. Action tools
   render expanded; read tools render collapsed (header only).
4. Expanded by default; long `OUT` truncated with a "show more" toggle; `failed`
   status visually distinct; `running` status shows a spinner.

## Non-Goals

- No change to how Codex executes tools or to the tool set itself.
- No change to the orchestrator, polling, or session-log streaming transport.
- No redesign of non-tool entries (assistant/user/reasoning/event cards) beyond
  what is required to host the shared block.
- No persistence schema migration (existing `tool_calls` JSON map is reused).

## Architecture

### Shared component

New `tracker/src/components/shared/ToolCallBlock.tsx` plus a common view-model:

```ts
interface ToolCallView {
  toolType: string;        // bold header label, e.g. "Bash", "Create issue"
  description: string | null; // grey header text (model desc, else derived)
  status: "running" | "completed" | "failed" | null;
  input: { value: string; language: ToolBlockLanguage } | null;  // IN
  output: { value: string; language: ToolBlockLanguage } | null; // OUT
  defaultCollapsed: boolean; // reads collapse by default; actions expand
}
```

`ToolBlockLanguage = "bash" | "json" | "diff" | "markdown" | "text"`.

Each surface maps its native data into `ToolCallView` via a small adapter, so the
component itself has no surface-specific logic.

Layout (matches the screenshot):

```
ToolCallBlock
 ├─ Header (button, toggles expand): icon + toolType (bold) + description (grey) + status badge
 ├─ IN  (label "IN")  → mono/dark code block (value, language-highlighted)
 └─ OUT (label "OUT") → mono/dark code block; long values truncated + "show more"
```

Truncation threshold: ~20 lines or ~2 KB, whichever first. Truncated state shows
a trailing "… show more" control that expands the full value inline.

### Surface 1 — Execution session log (frontend pairing)

**Backend (`elixir/lib/symphony_elixir/codex/session_log.ex`):**
- Add `call_id` to the parsed entries for `function_call`, `function_call_output`,
  `custom_tool_call`, and `custom_tool_call_output` items (read from the rollout
  JSONL `call_id` field; pass through `entry/4` as a new optional key).
- For `function_call_output`/`custom_tool_call_output`, keep the existing body but
  the title becomes irrelevant once paired (the call entry owns the header).

**Type (`tracker/src/types/session-log.ts`):**
- Extend `SessionLogEntry` with an optional `callId: string | null`.
- `normalizeSessionLogEntry` reads `record.call_id`/`record.callId`.

**Hook (`tracker/src/hooks/useSessionLogChannel.ts`):**
- After accumulating entries, derive a rendered list that merges each
  `tool_call` with the matching `tool_result` (same `callId`) into one paired
  item. Unpaired `tool_call` (result not yet streamed) renders with `status:
  running` and no `OUT` yet; the later `tool_result` fills `OUT` in place.
- Entries without a `callId` (legacy/edge) fall back to current per-card behavior.
- Pairing is pure and incremental: recompute from the flat `entries` array on each
  update; do not mutate the source stream. This keeps the offset/poll model
  untouched.

**Card (`tracker/src/components/issues/issue-detail/SessionLogEntryCard.tsx`):**
- For a paired tool entry, render `ToolCallBlock` instead of two `CollapsibleCard`s.
- `toolType`: humanized tool name (`Bash` for `exec_command`, else humanized name).
- `description`: model-provided description if present in the rollout, else derived
  from the command's first non-empty line (truncated).
- `input.language`: existing `tool_language` result (`bash`/`diff`/`json`/`text`).
- Default expanded (these are the primary content of an execution).

### Surface 2 — Assistant chat (backend + frontend)

**Backend capture (`elixir/lib/symphony_elixir/assistant/codex_session.ex`):**
- `tool_call_from_payload/3` currently returns `%{name, status, result}`. Extend to:
  - `arguments`: from `payload["params"]["arguments"]` (confirmed available via
    `coding_agent.ex` `tool_call_arguments/1`).
  - `output`: a presentable string derived from `result`:
    - success → `result["toolResult"]["message"]` plus a compact summary of
      `result["toolResult"]["data"]` (issue identifier/title, count, etc.).
    - failure → error message from `result["contentItems"]` / `result["error"]`.
  - Keep `result` for backward compatibility (issue extraction logic in
    `assistant_channel.ex` / `history.ex` depends on it).
- `upsert_tool_call/2` already merges by name within a turn; the `arguments`
  captured at `started` must survive the `completed` upsert (merge fields rather
  than replace).

**Persistence:** `tool_calls` is a free-form JSON map (`%{"calls" => [...]}`); the
new `arguments`/`output` keys ride along with no migration. `Message` schema and
`History` (`normalize_tool_calls`, `tool_calls`, `message_payload`) need no
structural change — they already pass calls through opaquely.

**Channel:** `assistant_channel.ex` already forwards `tool_call` maps verbatim in
`tool_call_started` / `tool_call_completed` and in `message_payload`. The new keys
flow through automatically.

**Frontend type (`tracker/src/services/assistant.ts`):**
- Extend `AssistantToolCall` with `arguments?: unknown` and `output?: string | null`.
- `normalizeToolCall` reads `dto.arguments` and `dto.output` (snake/camel tolerant).

**Frontend render (`ProjectAssistantPanel.tsx`):**
- Replace `ToolCallSummary` with a `ToolCallBlock` adapter.
- `toolType`: humanized tool name (`Create issue`, `Move issue`, `Dispatch Codex`…).
- `description`: the result `message` when present (e.g. "Moved issue MAC-1 to In
  Progress").
- `input`: `arguments` rendered as pretty JSON (`language: "json"`).
- `output`: `output` string (`language: "text"`/`markdown`).
- **Collapse policy:** action tools expanded, read tools collapsed.

#### Relevant vs. collapsed tool classification (assistant chat)

Frontend allowlist (backend keeps sending all calls — useful for history/debug):

| Class | Tools | Default state |
|-------|-------|---------------|
| Action (expanded) | `create_issue`, `create_draft_issue`, `update_issue`, `move_issue`, `dispatch_codex`, `add_comment`, GitHub mutations | expanded |
| Read (collapsed) | `list_issues`, `get_issue`, `get_agent_executions`, `read_workspace_file`, `get_workflow`, `get_template`, GraphQL reads, dynamic tools | collapsed (header only) |

Classification lives in one frontend helper (`isActionTool(name): boolean`) so the
list is easy to adjust. Nothing is hidden entirely — reads are present but collapsed.

## Data Flow

### Execution
```
rollout JSONL (function_call + function_call_output, same call_id)
  → session_log.ex parse (entries now carry call_id)
  → session_log channel "entries"
  → useSessionLogChannel (merge by call_id → ToolCallView)
  → SessionLogEntryCard → ToolCallBlock
```

### Assistant chat
```
codex app-server tool_call_started/completed (params.arguments, result)
  → codex_session relay (capture arguments + derive output)
  → assistant_channel "tool_call_started"/"tool_call_completed" + persisted message
  → assistantChannel.ts event binding → assistant.ts normalizeToolCall (arguments, output)
  → ProjectAssistantPanel → ToolCallBlock (action expanded / read collapsed)
```

## Error Handling

- **Missing OUT (execution):** `tool_call` without a matching `tool_result` renders
  as `running` (spinner, no OUT section) until the result streams in.
- **Failed tool (assistant chat):** `status: "error"/"failed"` → red-tinted header
  and the failure message in `OUT`.
- **Malformed arguments/result:** adapters guard for non-string/non-object values;
  fall back to `inspect`/`String(...)` and `language: "text"`. Never throw in render.
- **Legacy entries without `callId`:** fall back to current separate-card rendering.
- **Very large OUT:** truncated to the threshold; full value available via "show more".

## Testing

- **Backend (ExUnit):**
  - `session_log.ex`: `function_call`/`function_call_output` parse includes
    `call_id`; languages preserved (`bash` for `exec_command`, `diff` for
    `apply_patch`).
  - `codex_session.ex`: `tool_call_from_payload` captures `arguments` on start and
    merges `output` on completion (success and failure shapes); `result` still
    present for issue extraction.
- **Frontend (Vitest/RTL):**
  - `ToolCallBlock`: renders header/IN/OUT, status states, truncation toggle.
  - session-log pairing: two entries with same `callId` merge into one block; the
    running→completed transition fills OUT; unpaired/legacy fall back.
  - `ProjectAssistantPanel`: action tools expanded, read tools collapsed;
    `arguments`/`output` displayed.
- **Manual:** one Bash-heavy execution and one assistant turn that creates/moves an
  issue; verify IN/OUT and collapse behavior match the reference screenshot.

## Files Affected

**New**
- `tracker/src/components/shared/ToolCallBlock.tsx`

**Frontend (modified)**
- `tracker/src/types/session-log.ts` (add `callId`)
- `tracker/src/hooks/useSessionLogChannel.ts` (pair by `callId`)
- `tracker/src/components/issues/issue-detail/SessionLogEntryCard.tsx` (use block)
- `tracker/src/services/assistant.ts` (`AssistantToolCall.arguments`/`output`, normalize)
- `tracker/src/services/phoenix/assistantChannel.ts` (carry new fields if it strips)
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (block + allowlist)

**Backend (modified)**
- `elixir/lib/symphony_elixir/codex/session_log.ex` (emit `call_id`)
- `elixir/lib/symphony_elixir/assistant/codex_session.ex` (capture `arguments` + `output`)

No schema migration. `Message`/`History`/`AssistantChannel` pass new keys through
opaquely.
