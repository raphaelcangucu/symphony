# Assistant File-Activity Cards (Cursor-style file ops in the chat)

- **Date:** 2026-06-21
- **Status:** Draft (awaiting user review)
- **Area:** Issue/Project assistant chat (`elixir/` Phoenix channel + Codex app-server relay) and `tracker/` React SPA
- **Entry point:** `http://localhost:4000/tracker/projects/:project/assistant/issue/:id`

## 1. Summary

When the assistant (Codex/agent) touches files, the chat should show clean,
Cursor-style cards instead of a generic JSON box — e.g. `Read README.md · L1–60`,
`Edited foo.ex · +12 −3` (expandable to the diff), and `❯ mix test` (expandable to
the output).

Two cooperating layers, reusing the existing tool-call pipeline (approach **A**):

1. **Backend relay** — `relay_codex_event/3` learns to translate Codex's **native**
   file/command item events (`item/commandExecution/*`, `item/fileChange/*`,
   `item/started`/`item/completed`, `turn/diff/updated`) into the same `tool_call`
   shape the frontend already consumes (`tool_call_started`/`tool_call_completed`),
   carrying structured fields (path, line range, additions/deletions, diff,
   command) inside `arguments`/`result`. No new channel events, no new persistence.
2. **Frontend rendering** — a new `FileActivityCard` that `AssistantBubble` renders
   for file-operation tool calls; all other tool calls keep using the current
   `ToolCallBlock`. A small classifier decides which tool calls are "file activity".

Because completed assistant messages already persist `tool_calls`, the cards
re-render after a page refresh for free.

## 2. Background & current architecture

| Concern | Path |
|---------|------|
| Assistant event relay (Codex → callbacks) | `elixir/lib/symphony_elixir/assistant/codex_session.ex` (`relay_codex_event/3`, ~`:765`) |
| Channel push of tool calls | `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex` (`:548`, `:999`) |
| Tool-call presenter (args/output) | `elixir/lib/symphony_elixir/assistant/tool_call_presenter.ex` |
| Codex event humanizer (field paths reference) | `elixir/lib/symphony_elixir/codex/event_humanizer.ex` |
| Frontend tool-call type + normalize | `tracker/src/services/assistant.ts` (`AssistantToolCall`, `normalizeToolCall`) |
| Channel binding | `tracker/src/services/phoenix/assistantChannel.ts` |
| Tool-call → view mapper | `tracker/src/components/assistant/assistantToolCall.ts` |
| Generic renderer | `tracker/src/components/shared/ToolCallBlock.tsx` |
| Chat bubble that renders tool calls | `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (`AssistantBubble`, ~`:1281`) |
| i18n | `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json` (`issue.toolCall.*`) |

**What shows today:**

- The assistant's **own MCP read tools** (e.g. `read_workspace_file`, which takes
  `path` + `start_line`/`end_line`) reach the chat as tool calls (via the
  `item/tool/call` path) and render in the generic blue `ToolCallBlock` (tool name +
  JSON args + text output).
- The Claude adapter's tool activity surfaces via the `item/created` notification
  branch in `relay_codex_event/3`.

**The gap:**

1. **Codex's native file ops are invisible in the chat.** `relay_codex_event/3`
   only handles `item/agentMessage/delta`, the `:tool_call_*` events (which come
   from `item/tool/call`, i.e. MCP tools), `:user_input_required`, and the Claude
   `item/created`/`item/progress` branches. Codex's native `item/fileChange/*`,
   `item/commandExecution/*`, `item/started`/`item/completed`, and
   `turn/diff/updated` are **not relayed** to the chat (they only appear in the
   execution session log for dispatched runs).
2. **Even the reads that do show up look raw.** `read_workspace_file` renders as a
   JSON blob in a blue box, not as `Read path · L1–60`.

## 3. Goals & non-goals

**Goals**

- Render file reads, file edits, and shell commands as compact, Cursor-style cards
  in the assistant chat, expandable to content/diff/output.
- Surface Codex's **native** file edits and commands in the chat (not just MCP
  reads), with a diff and `+N −M` line counts for edits.
- Reuse the existing tool-call pipeline and persistence so cards re-render on
  refresh and in loaded history with no new channel events or DB schema.
- Keep all non-file tool calls rendering exactly as today.

**Non-goals**

- Manual approval UI in the chat. File ops stay auto-approved as today; this is
  **view-only**.
- Grouping consecutive reads into "Explored N files". Deferred to a Phase 2
  follow-up (see §11).
- Live per-keystroke diff streaming. We render the diff that arrives with the
  file-change item / `turn/diff/updated`; we do not rebuild delta fan-out.
- Changing the execution session-log view (`IssueSessionLog` / `sessionToolCall.ts`).
  It already has its own pairing/rendering and is out of scope.
- Adding file activity for non-Codex agents beyond what their adapter already
  emits (Claude continues via the existing `item/created` branch).

## 4. Backend — relay Codex file/command items as tool calls

Extend `relay_codex_event/3` in `codex_session.ex` with branches that translate
native Codex item events into the **same tool-call shape** the existing branches
emit, then call `:on_tool_call_started` / `:on_tool_call_completed`. Dedup is keyed
by the Codex **item id** (mirroring the Claude `item/created` path, which keys by
`tool_use_id` via `upsert_tool_call_by_id/3`).

### 4.1 Event → tool-call mapping

Field paths follow the same fallbacks `EventHumanizer` already uses (string and
atom keys; `params.item`, `params.parsedCmd`/`command`/`cmd`/`argv`,
`params.fileChangeCount`/`changeCount`, `params.diff`, `turn/diff/updated`'s
`params.diff`). The concrete `item.type` strings (e.g. `command_execution` vs
`commandExecution`, `file_change` vs `fileChange`) are confirmed against a captured
rollout in the implementation plan's first step.

| Codex event | tool_call `name` | `status` | `id` | structured payload |
|-------------|------------------|----------|------|--------------------|
| `item/started` where item type is command | `shell` | `running` | `item.id` | `arguments: { command }` |
| `item/commandExecution/outputDelta` | (no new call; ignored for now — see §7) | — | — | — |
| `item/completed` where item type is command | `shell` | `complete`/`error` (from `item.status`) | `item.id` | `arguments: { command }`, `output: <captured stdout/stderr>`, `result: { exit_code }` |
| `item/started` where item type is file change | `apply_patch` | `running` | `item.id` | `arguments: { paths: [...] }` |
| `item/fileChange/requestApproval` (auto-approved) | `apply_patch` | `running` | request/item id | `arguments: { paths, file_count }` |
| `item/completed` where item type is file change, or `item/fileChange` final | `apply_patch` | `complete`/`error` | `item.id` | `result: { diff, additions, deletions, paths }` |
| `turn/diff/updated` | enrich the latest `apply_patch` call (fill/replace `result.diff` + recompute counts) | — | latest open patch id | `result: { diff, additions, deletions }` |

Notes:

- **Reads** (`read_workspace_file` and any future read tool) already arrive via the
  MCP `item/tool/call` path — **no backend change** for reads; they're handled
  entirely by the frontend classifier (§5–§6) reading `arguments.path` +
  `start_line`/`end_line`.
- **Additions/deletions** are derived from the diff in Elixir
  (`count "+"`/`"−"`-prefixed lines, excluding `+++`/`---` headers) so the frontend
  gets ready-to-render numbers; the raw `diff` is also included for the expanded
  view.
- A new private presenter, `FileActivityPresenter`, owns this derivation (path
  extraction from a unified diff, add/del counts, command normalization) so
  `relay_codex_event/3` stays a thin dispatcher and the logic is unit-testable in
  isolation. `ToolCallPresenter` is unchanged.

### 4.2 Tool-call payload contract (backend → frontend)

The relayed tool calls reuse the existing `AssistantToolCall` shape. The frontend
contract for file-activity cards is:

- **Read** (MCP read tool): `name ∈ {read_workspace_file, read_file}`,
  `arguments: { path, start_line?, end_line?, issue_identifier? }`.
- **Edit**: `name ∈ {apply_patch, edit_file, write_file}`,
  `result: { diff?: string, additions?: number, deletions?: number, paths?: string[] }`.
- **Command**: `name ∈ {shell, exec_command, bash}`,
  `arguments: { command: string }`, `output: string`, `result: { exit_code?: number }`.

All fields are optional/defensive; the card degrades gracefully when a field is
missing (e.g. edit with no diff yet → shows just the filename + running spinner).

## 5. Frontend — classifier + view model

Add `tracker/src/components/assistant/fileActivity.ts`:

```ts
export type FileActivityKind = "read" | "edit" | "command";

export interface FileActivityView {
  kind: FileActivityKind;
  title: string;          // primary filename or command
  path: string | null;    // for read/edit
  lineRange: string | null;   // "L1–60" for reads with start/end
  additions: number | null;   // for edits
  deletions: number | null;   // for edits
  status: "running" | "complete" | "error";
  body: { value: string; language: "diff" | "bash" | "text" } | null; // expanded content
}

export function fileActivityFromToolCall(call: AssistantToolCall): FileActivityView | null;
```

- Returns `null` for tool calls that are **not** file activity, so the bubble falls
  back to `ToolCallBlock`. The classifier matches on `name` (the sets in §4.2).
- `read`: `path` from `arguments.path`; `lineRange` from `start_line`/`end_line`
  (`L{start}–{end}`, or `L{start}–` / `L–{end}` when only one is set); `body` from
  `output` (language `text`).
- `edit`: `additions`/`deletions` from `result`; `path`/`title` from
  `result.paths` (first path; "N files" when >1); `body` from `result.diff`
  (language `diff`).
- `command`: `title`/`body` from `arguments.command` (language `bash`);
  `body` also includes `output` when present.

## 6. Frontend — `FileActivityCard`

New `tracker/src/components/assistant/FileActivityCard.tsx`. Visual mirrors the
existing `ToolCallBlock` shell (rounded border, collapsible) but with a file-aware
header:

- **Icon:** `FileText` (read), `FilePenLine`/`Pencil` (edit), `TerminalSquare`
  (command); `Loader2` spinner when `status === "running"`.
- **Header row (read):** `Read` · monospace filename · muted `L1–60`.
- **Header row (edit):** `Edited` · filename · green `+12` / red `−3` badges.
- **Header row (command):** `❯` · monospace command (truncated).
- **Collapsed by default** (including edits — summary only). Click expands `body`:
  - diff rendered with per-line add/remove tinting (reuse `ToolCallBlock`'s clamp +
    "show more"); commands/reads render as preformatted text.
- **Failed** state uses the same destructive border treatment as `ToolCallBlock`.

`AssistantBubble` wiring (`ProjectAssistantPanel.tsx`, ~`:1281`):

```tsx
{message.toolCalls.map((toolCall, index) => {
  const activity = fileActivityFromToolCall(toolCall);
  return activity ? (
    <FileActivityCard view={activity} key={`fa-${index}`} />
  ) : (
    <ToolCallBlock view={assistantToolCallToView(toolCall)} key={`${toolCall.name}-${index}`} />
  );
})}
```

The streaming/`WorkingIndicator` `activeTool` lookup is unchanged (still reads
`toolCalls.find(status === "running").name`), so a running edit/read also drives
the "working" label.

## 7. Streaming vs. lifecycle (scope boundary)

- `outputDelta` events (`item/commandExecution/outputDelta`,
  `item/fileChange/outputDelta`) are **not** relayed as their own tool calls in v1.
  The card shows the final captured output/diff from the completion event. This
  avoids rebuilding delta fan-out and keeps one card per operation. (Live streaming
  into the card body is a possible Phase 2.)
- `tool_call_started` is emitted on the first event for an item (so a spinner card
  appears while the op runs); `tool_call_completed` carries the final diff/output.

## 8. i18n

Add under `issue.toolCall` in `en` and `pt-BR` (`tracker/locales/*/tracker.json`):

```json
"fileActivity": {
  "read": "Read",
  "edited": "Edited",
  "created": "Created",
  "command": "Ran command",
  "files": "{{count}} files",
  "additions": "+{{count}}",
  "deletions": "−{{count}}"
}
```

Existing `issue.toolCall.tools.*` keys gain entries for any new surfaced tool names
(`apply_patch`, `shell`, `read_workspace_file`) so non-classified fallbacks still
localize.

## 9. Error handling & edge cases

- **Missing diff on an edit** → card shows filename + spinner (running) or filename
  with no counts (complete); never crashes on absent `result.diff`.
- **Multi-file patch** → title shows `N files`; expanded diff shows the full patch;
  counts are the patch totals.
- **Command with huge output** → reuse `ToolCallBlock`'s clamp (`MAX_LINES`/
  `MAX_CHARS`) + "show more".
- **Unknown/again-running item id** → `upsert_tool_call_by_id/3` merges into the
  existing started entry, preserving `name`/`arguments`.
- **Non-Codex / classifier miss** → `fileActivityFromToolCall` returns `null`,
  falling back to `ToolCallBlock` (no regression for existing tool calls).
- **History reload** → cards rebuild from persisted `tool_calls` (same path), since
  the structured fields live in `arguments`/`result` which are already persisted.

## 10. Testing

**Elixir** (`elixir/test/...`)

- `FileActivityPresenter`: diff → `{additions, deletions, paths}`; command
  normalization (binary, argv list); empty/garbage diff → safe defaults.
- `codex_session_test.exs`: feed synthetic `item/started`+`item/completed`
  (command and fileChange) and `turn/diff/updated` payloads through
  `relay_codex_event/3`; assert `:on_tool_call_started`/`:on_tool_call_completed`
  fire with the expected `name`/`status`/`arguments`/`result`, and that re-emitting
  the same item id upserts (no duplicate card).
- Quality gate: `make all` and `mix specs.check` (public `def` in `lib/` need
  `@spec`).

**Frontend** (`tracker/src/...`)

- `fileActivity.test.ts`: read → `lineRange` formatting; edit → counts + diff body;
  command → bash body; non-file tool call → `null`.
- `FileActivityCard.test.tsx`: header per kind; collapsed-by-default; expand shows
  body; failed styling; running spinner.
- `ProjectAssistantPanel.test.tsx`: a message with a file-edit tool call renders a
  `FileActivityCard`; a non-file tool call still renders `ToolCallBlock`.
- `assistantChannel.test.ts`: relayed file-op `tool_call_*` payloads normalize into
  `AssistantToolCall` with the structured `result`/`arguments` intact.

## 11. File map

**New**

- `elixir/lib/symphony_elixir/assistant/file_activity_presenter.ex`
- `tracker/src/components/assistant/fileActivity.ts`
- `tracker/src/components/assistant/FileActivityCard.tsx`
- `tracker/src/components/assistant/__tests__/fileActivity.test.ts`
- `tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx`

**Changed**

- `elixir/lib/symphony_elixir/assistant/codex_session.ex` (new relay branches +
  dedup by item id)
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (`AssistantBubble`
  chooses `FileActivityCard` vs `ToolCallBlock`)
- `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`
  (`issue.toolCall.fileActivity.*` + new `tools.*`)
- Tests listed in §10.

**Docs (same PR if behavior/config changes)**

- `elixir/README.md` and/or `elixir/docs/logging.md` only if new relayed fields
  warrant a note (likely a short line under the assistant section).

## 12. Build order (independently shippable)

1. **Frontend-only reads** — classifier + `FileActivityCard` for the reads that
   already arrive (`read_workspace_file`); bubble wiring. Immediately visible, no
   backend change, de-risks the UI.
2. **`FileActivityPresenter`** — pure diff/command derivation + unit tests (no wiring).
3. **Backend relay** — new `relay_codex_event/3` branches for command + fileChange +
   `turn/diff/updated`, using the presenter; dedup by item id.
4. **Edit/command cards** — extend the classifier/card to render the relayed edits
   and commands end-to-end; channel/normalize tests.
5. **i18n + docs polish.**

Each step keeps `make all` and the frontend tests green; step 1 ships a visible
improvement on its own.

## 13. Open questions / risks

- **Exact Codex `item.type` strings** for command/file-change items — confirm
  against a captured rollout in step 1 of the plan; the relay matches on the
  `item/commandExecution/*` and `item/fileChange/*` method namespaces plus the item
  type, so a string mismatch is contained to one helper.
- **Does the assistant chat actually run Codex with a writable workspace?** If
  edits are rare in authoring/project mode, the command + read cards still deliver
  most of the value; edit cards light up wherever Codex does patch. (Confirm the
  mode during step 3.)
- **"Explored N files" grouping** — deferred (Phase 2). Confirm v1 ships per-op
  cards without grouping.
