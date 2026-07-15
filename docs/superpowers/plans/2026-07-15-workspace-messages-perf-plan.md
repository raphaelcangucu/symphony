# Workspace Messages Load Performance — Implementation Plan

**Date:** 2026-07-15
**Status:** in progress
**Related design (UX):** [`2026-07-10-assistant-scroll-compact-timeline-design.md`](../specs/2026-07-10-assistant-scroll-compact-timeline-design.md)

## Problem (measured)

Opening `/tracker/projects/advising/workspaces/8006` freezes while messages load.

Evidence (SQLite `elixir/.symphony/tracker.sqlite3`, thread `8006`):

| Field | Total |
| --- | --- |
| `content` (26 msgs) | 25 KB |
| `metadata` | 38 KB |
| **`tool_calls`** | **3.36 MB** |

Concentrated in 3 assistant messages (seq 22 = 1.75 MB with 108 tool calls incl. one
`shell` output of ~1 MB; seq 11 = 1.33 MB; seq 26 = 190 KB).

Root causes (chained):

1. **Uncapped `shell` tool output** persisted raw (`read_tools.ex` caps reads at 64 KB, but
   shell has no cap) → single outputs up to 1 MB.
2. **No pagination in join payload:** `History.list_messages_for_thread/1` is `Repo.all`
   without `LIMIT`; `join_history_payload/1` + `push_history_sync/1` push **all** messages
   (~3.4 MB) at once and re-push on every terminal turn.
3. **Per-render reprocessing on the client:** `assistantToolCallToView(call)` runs inline
   (unmemoized) and calls `formatToolOutput` → `value.trim()` + `JSON.parse` over the full
   output (up to 1 MB) for every tool call every render.
4. **No compact history window / "load older"** despite the approved 2026-07-10 design.

## Goals

- Cut the workspace-open payload from ~3.4 MB to a few hundred KB.
- Never lose data: full tool output fetchable on demand.
- Show only the current run by default; "Load old prompts" expands (spec 2026-07-10 §2).
- Keep behavior stable for normal threads (generous defaults).

## Non-goals

- `useAssistantScroll` rewrite (spec 2026-07-10 §1) — out of scope this cycle.
- List virtualization (explicit non-goal in spec).
- Migrating historical shell outputs.

## Contract

### A. Tool-output cap (history payloads only)

`History.message_payload/2` gains `opts`:

- `:cap_tool_output_bytes` (integer | nil, default nil = no cap).

`message_payload/1` delegates to `/2` with `[]` (unchanged for REST + live pushes).

When capping and a tool call's `output` (string) exceeds the cap:

- Replace `output` with a head slice of `cap` bytes (valid UTF-8 boundary) + a marker.
- Add `output_truncated: true` and `output_byte_size: <original byte size>`.

Applied only in `join_history_payload/1` and `push_history_sync/1` via
`@history_tool_output_cap_bytes 8_192`.

### B. On-demand full output

New channel handler:

```
handle_in("fetch_tool_output", %{"message_id" => id, "tool_call_id" => tcid}, socket)
  → {:reply, {:ok, %{message_id, tool_call_id, output, output_byte_size}}, socket}
  (thread scoped by socket.assigns.thread; 404-style error if not found)
```

Frontend `fetchToolOutput(channel, messageId, toolCallId)` resolves the full string; the
truncated tool `Section` shows a "Load full output (N KB)" affordance.

### C. Message pagination (join window + load older)

`History.list_messages_for_thread/2` gains `opts`:

- `:limit` (default nil = all; channel passes `@history_page_limit 40`).
- `:before_sequence` (nil) — returns messages with `sequence < before_sequence`.

Returns newest `limit` messages **in ascending sequence order**.

Join/sync payload adds:

- `has_more_before: boolean`
- `oldest_sequence: integer | nil`

New channel handler:

```
handle_in("load_older_messages", %{"before_sequence" => seq}, socket)
  → {:reply, {:ok, %{messages: [...capped...], has_more_before, oldest_sequence}}, socket}
```

Frontend `loadOlderMessages(channel, beforeSequence)` prepends older messages.

### D. Frontend compact window + memoization

- `getCurrentPromptWindow(messages)` (spec §2): default view = slice from latest user msg.
- `AssistantMessageList` header "↑ Load old prompts (N)": first click expands in-memory;
  when in-memory history exhausted and `hasMoreBefore`, triggers `load_older_messages`.
- Re-compact on new user send.
- Memoize `assistantToolCallToView` per call (`useMemo`/module cache keyed by id+status+len)
  and timeline group building so full-output strings are not reprocessed per render.

## Tasks (priority order; test each; do NOT auto-commit)

1. **BE cap** — `history.ex` `message_payload/2` + cap helper; channel join/sync use cap.
   Test: `elixir/test/.../history_test.exs` (cap truncates, adds flags; `/1` unchanged).
2. **BE fetch_tool_output** — channel handler + `History.tool_call_output/2`.
   Test: channel handler returns full output; unknown ids error.
3. **BE pagination** — `list_messages_for_thread/2` opts + join/sync meta +
   `load_older_messages` handler. Test: limit/before_sequence ordering + meta flags.
4. **FE types + channel client** — `AssistantToolCall.outputTruncated/outputByteSize`,
   history meta (`hasMoreBefore`, `oldestSequence`), `fetchToolOutput`,
   `loadOlderMessages`. Test: `assistantChannel.test.ts` normalize.
5. **FE compact window** — `getCurrentPromptWindow` + test.
6. **FE panel/list wire** — visibleMessages window, Load-old-prompts button, load-older
   fetch + prepend, re-compact on send, memoized tool view. Tests: list + window.
7. **Verify** — targeted vitest + mix; manual on thread 8006.

## WSL test rule

Run ONE targeted test file/filter at a time, sequentially. No suite-wide runs.
