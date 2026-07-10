# Assistant scroll, compact history & interleaved timeline (Jean parity)

**Date:** 2026-07-10  
**Status:** Approved for planning  
**Approach:** UX parity with Jean via Symphony-owned modules (not a literal Jean port)

## Problem

Symphony’s assistant chat scroll and transcript layout feel worse than Jean’s:

1. **Send** — new user message often not brought into view reliably.
2. **Streaming** — scrolling up to read is fought by auto-follow.
3. **Stream end** — final layout can leave the tail cut off / not truly at bottom.
4. **Prepend / history** — loading older content jumps the viewport.
5. **History density** — full thread is always shown; Jean consolidates to the current prompt/run with “↑ Load old prompts (N)”.
6. **Tool placement** — tools/events render in a block at the **end** of the assistant bubble; Jean interleaves them with text in stream order.

## Goals

- Jean-like **follow-tail** scroll that respects intentional scroll-away.
- **Compact history** by default (current user prompt + its run); expand via “Load old prompts”.
- **Interleaved timeline** for text ↔ tools during stream **and** after reload.
- Keep changes scoped to the **Assistant panel** (not Execution session log).
- Prefer Symphony modules over copying Jean’s virtualized list wholesale.

## Non-goals

- Virtualized message list.
- Desktop plan-pinning / “scroll to findings” floating actions.
- Bulk migration of historical messages to `content_blocks`.
- Changing Execution / Agent tab transcript rendering in this cycle.

## Architecture

```
ProjectAssistantPanel
├── useAssistantScroll          ← follow-tail, cooldown, scrollend, prepend anchor
├── compactHistoryWindow        ← startIndex + hiddenPromptCount
├── AssistantMessageList
│   ├── "↑ Load old prompts (N)"
│   └── AssistantChatMessageBubble
│       └── AssistantTurnTimeline  ← text ↔ tools in stream order
└── (Elixir) content_blocks on persisted assistant messages
```

Three cooperating modules; no full chat rewrite.

---

## 1. Scroll — `useAssistantScroll`

Replaces `chatScrollStickiness` usage in `ProjectAssistantPanel`.

### State model

| Concept | Role |
| --- | --- |
| `isFollowingTail` | User wants live follow (may be true even if not physically at bottom during smooth scroll). |
| `isAtBottom` | Viewport within bottom threshold (UI: hide/show Bottom button). |
| `isAutoScrolling` | Smooth scroll in flight; `handleScroll` must not flip stickiness mid-animation. |
| `userScrollUpUntil` | Cooldown (~1s) after intentional scroll-up before re-stick is allowed. |

Threshold: ~100px from bottom (Jean). Short / non-overflow chats are always treated as at bottom (no Bottom button; wheel-up does not mark scrolled-away).

### Behaviors

- **Wheel/touch up** (with overflow): stop following; start cooldown; cancel in-flight auto-scroll.
- **Wheel/touch down** or scroll reaching bottom: clear cooldown; resume following.
- **While the assistant turn is running** (Symphony’s existing running/streaming flag, Jean’s `isSending` analog): ResizeObserver + rAF-coalesced `scrollToTail` only if `isFollowingTail` and outside cooldown.
- **Bottom button:** keep the existing floating control; wire it to `scrollToBottom()` (re-enables follow).
- **Streaming start** (if following): smooth scroll to tail; on `scrollend` (fallback 400ms) correct undershoot.
- **Streaming end** (if following): double-rAF pin to true bottom (late layout).
- **Send:** `markAtBottom()` (logical follow on; physical scroll via observer / start transition).
- **Thread / workspace switch:** `useLayoutEffect` instant pin to bottom; reset follow state.
- **Prepend (load older):** capture/restore via message-id anchor (`data-message-anchor-id`), not only `scrollHeight` delta — port Jean `message-scroll-anchor` idea into Symphony helpers.
- **Keyboard scroll (optional same cycle if cheap):** `beginKeyboardScroll` / `endKeyboardScroll` so PageUp etc. don’t fight auto-follow.

### API (sketch)

```ts
scrollRef
isAtBottom
scrollToBottom(instant?: boolean)
markAtBottom()
beginKeyboardScroll()
endKeyboardScroll()
```

---

## 2. Compact history

### Window

`getCurrentPromptWindow(messages)`:

- Find latest `role === "user"` index → `startIndex`.
- If no user message, `startIndex = last message` (never blank the list).
- `hiddenPromptCount` = number of user messages before `startIndex`.

### UI

- Local `expandedHistory: boolean` (default `false`).
- Collapsed: render `messages.slice(startIndex)`.
- Top control when there is older content: `↑ Load old prompts (N)`.
- First click expands in-memory history (messages already loaded).
- If server-side older pages exist later, same control triggers fetch + prepend anchor restore.

### Re-compact rule

On a **new user message** (send), set `expandedHistory = false` so the viewport focuses the new current run (Jean-like consolidation).

---

## 3. Interleaved timeline — `contentBlocks`

### Problem today

`AssistantChatMessageBubble` renders markdown `content`, then **all** `toolCalls` under a border at the bottom. Order of work during the turn is lost.

### Message shape

Keep existing `content` (full text for search/compat) and `toolCalls[]` (status/args/output by id).

Add ordered UI blocks:

```ts
type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "tool"; toolCallId: string };

// on assistant messages
contentBlocks?: AssistantContentBlock[];
```

### Stream construction

**Authoritative builder: Elixir agent-session collector** (same process that already accumulates `assistant_message` + `tool_calls`). That way reload, other tabs, and history agree on order.

- Text delta: append to last `text` block or push new `text`.
- Tool start: push `{ type: "tool", tool_call_id }`; upsert tool in `tool_calls` by id.
- Tool complete/error: update `tool_calls` entry only (block list unchanged).
- Final `content` = full assistant text string (unchanged contract); blocks are UI order only.

**Live UI:** channel events may also carry incremental block updates (or the client mirrors the same rules from existing token/tool events) so the bubble interleaves before the final history sync. Final history payload wins on conflict.

### Persist (Elixir)

- Persist `content_blocks` on the assistant message with the turn.
- History / channel payloads include `content_blocks`.
- Client normalizes snake_case ↔ camelCase.

### Render

- If `contentBlocks?.length`: render `AssistantTurnTimeline` — text segments as markdown; tool ids resolved via `toolCalls` into existing `ToolActivityTimeline` / tool row components **inline**.
- Else: **fallback** current layout (`content` + tools at end) for legacy rows. No mandatory backfill.

### Stacking / grouping

v1: simple sequential blocks (text / tool). Optional Jean-style “stacked group” of consecutive tools can follow later; not required for first ship.

---

## Data flow (send → done)

1. User sends → `markAtBottom()` + follow on; compact window re-collapses to new user message.
2. Optimistic / confirmed user message appears; scroll follows if following.
3. Stream deltas build `contentBlocks` + `toolCalls`; ResizeObserver keeps tail in view while following.
4. User scrolls up → follow stops; Bottom button restores follow.
5. Stream ends → double-rAF pin if still following.
6. History sync returns message with `content_blocks`; UI stays interleaved after reload.

---

## Edge cases

| Case | Behavior |
| --- | --- |
| Non-overflow chat | Always at bottom; no Bottom button; no false “scrolled away”. |
| Smooth scroll in flight | Ignore stickiness flips from intermediate scroll events. |
| Assistant-only thread | Compact window shows last message. |
| Expand then send | Re-compact on new user message. |
| Legacy message | Fallback end-stacked tools. |
| Tool with no surrounding text | Single tool block. |
| Reconnect mid-turn | Prefer blocks from history; if only flat `tool_calls`, fallback. |
| Prepend while expanded | Restore via message-id anchor. |

---

## Files (expected)

**Tracker**

- Replace/evolve `tracker/src/components/assistant/chatScrollStickiness.ts` → `useAssistantScroll` (+ anchor helpers).
- `ProjectAssistantPanel.tsx` — wire scroll + compact + send/`isSending`.
- `AssistantMessageList` / list header — Load old prompts.
- `AssistantChatMessageBubble.tsx` — timeline vs fallback.
- `services/assistant.ts` + `phoenix/assistantChannel.ts` — types + normalize `content_blocks`.
- Unit/component tests for window, scroll helpers, block builder, bubble, channel.

**Elixir**

- Assistant agent session collector / message persistence / `History` public message — write and return `content_blocks`.
- Tests for round-trip on history payload.

---

## Testing

- **Unit:** `getCurrentPromptWindow`; scroll at-bottom / cooldown / non-overflow; prepend anchor; content-block merge/insert.
- **Component:** interleaved bubble vs fallback; Load old prompts expands; send marks follow / re-compacts.
- **Channel/history:** `content_blocks` normalize round-trip.
- **E2E visual:** not required for this cycle if unit/component cover behavior.

## Success criteria

1. After send, the new user message is visible; while following, stream stays tailed without fighting scroll-up.
2. After stream completes (while following), viewport sits on the true bottom (no clipped tail).
3. Default view is current prompt/run; “Load old prompts” expands without jump; new send re-compacts.
4. Tools and text appear in stream order live **and** after full reload when `content_blocks` present.

## Jean references

Analyzed at `/tmp/jean-analysis` (fresh clone):

- `src/components/chat/hooks/useScrollManagement.ts`
- `src/components/chat/compact-history-window.ts`
- `src/components/chat/message-scroll-anchor.ts`
- `src/components/chat/tool-call-utils.ts` (timeline items / content blocks)
- `CompactMessageList.tsx` — “↑ Load old prompts (N)”

## Implementation next step

Write an implementation plan via `writing-plans` (`docs/superpowers/plans/2026-07-10-assistant-scroll-compact-timeline-plan.md`) after user reviews this spec.
