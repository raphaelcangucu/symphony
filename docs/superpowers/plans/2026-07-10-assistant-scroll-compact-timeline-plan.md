# Assistant Scroll, Compact History & Interleaved Timeline — Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer one focused subagent per task with review between tasks. Run the exact commands listed; do not skip the failing-test step.

**Goal:** Make the Symphony assistant chat feel like Jean — follow-tail scroll that respects scroll-away, compact “current prompt” history with “Load old prompts”, and tools/text interleaved in stream order (live + after reload).

**Architecture:** Three Symphony-owned modules composed by `ProjectAssistantPanel`: (1) `useAssistantScroll` + message-id prepend anchors, (2) `compactHistoryWindow` + expand UI, (3) ordered `content_blocks` built in the Elixir agent-session collector, persisted on the message (`metadata["content_blocks"]`), normalized on the client, rendered by `AssistantTurnTimeline` with legacy fallback.

**Tech Stack:** React 19 + vitest + Testing Library (tracker); Elixir + ExUnit (assistant History / AgentSession). No new npm deps. No list virtualization.

**Spec:** [`docs/superpowers/specs/2026-07-10-assistant-scroll-compact-timeline-design.md`](../specs/2026-07-10-assistant-scroll-compact-timeline-design.md)

**Jean references (read-only):** `/tmp/jean-analysis/src/components/chat/hooks/useScrollManagement.ts`, `compact-history-window.ts`, `message-scroll-anchor.ts`

---

## File Structure

**Create (tracker):**

- `tracker/src/components/assistant/compactHistoryWindow.ts` — `getCurrentPromptWindow`
- `tracker/src/components/assistant/messageScrollAnchor.ts` — capture/restore prepend anchors
- `tracker/src/components/assistant/contentBlocks.ts` — append text / push tool block helpers
- `tracker/src/components/assistant/useAssistantScroll.ts` — follow-tail hook
- `tracker/src/components/assistant/AssistantTurnTimeline.tsx` — interleaved render
- `tracker/src/components/assistant/__tests__/compactHistoryWindow.test.ts`
- `tracker/src/components/assistant/__tests__/messageScrollAnchor.test.ts`
- `tracker/src/components/assistant/__tests__/contentBlocks.test.ts`
- `tracker/src/components/assistant/__tests__/useAssistantScroll.test.ts` (DOM attach helpers)
- `tracker/src/components/assistant/__tests__/AssistantTurnTimeline.test.tsx`

**Create (elixir):**

- `elixir/lib/symphony_elixir/assistant/content_blocks.ex` — pure append/push helpers
- `elixir/test/symphony_elixir/assistant/content_blocks_test.exs`

**Modify (tracker):**

- `tracker/src/services/assistant.ts` — `AssistantContentBlock`, `contentBlocks` on message, normalize
- `tracker/src/components/assistant/assistantStream.ts` — maintain blocks while streaming
- `tracker/src/components/assistant/AssistantChatMessageBubble.tsx` — timeline vs fallback
- `tracker/src/components/assistant/AssistantMessageList.tsx` — load-old-prompts header + anchors
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — wire scroll hook, compact state, send re-compact
- `tracker/src/services/phoenix/assistantChannel.ts` — pass-through (normalize already in assistant.ts)
- `tracker/src/components/assistant/chatScrollStickiness.ts` — delete after hook lands (or thin re-export removed)
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json` — load old prompts strings
- Existing tests: `assistantStream.test.ts`, `assistantChannel.test.ts`, `AssistantChatMessageBubble` / panel tests as needed

**Modify (elixir):**

- `elixir/lib/symphony_elixir/assistant/agent_session.ex` — collector accumulates `content_blocks`
- `elixir/lib/symphony_elixir/assistant/history.ex` — `message_payload/1` exposes `content_blocks`; `append_message` accepts them into metadata
- Tests under `elixir/test/symphony_elixir/assistant/` for history payload + collector if present

**Storage note:** No DB migration. Persist blocks at `metadata["content_blocks"]` on `assistant_messages`. Public API still exposes top-level `content_blocks` in `message_payload/1`.

---

### Task 1: Compact history window (pure TS)

**Files:**

- Create: `tracker/src/components/assistant/compactHistoryWindow.ts`
- Test: `tracker/src/components/assistant/__tests__/compactHistoryWindow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getCurrentPromptWindow } from "@/components/assistant/compactHistoryWindow";

describe("getCurrentPromptWindow", () => {
  it("returns empty window for no messages", () => {
    expect(getCurrentPromptWindow([])).toEqual({ startIndex: 0, hiddenPromptCount: 0 });
  });

  it("starts at the latest user prompt and counts older user prompts", () => {
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
    ] as const;
    expect(getCurrentPromptWindow(messages)).toEqual({ startIndex: 2, hiddenPromptCount: 1 });
  });

  it("falls back to the last message when there is no user role", () => {
    const messages = [{ role: "assistant" }, { role: "assistant" }] as const;
    expect(getCurrentPromptWindow(messages)).toEqual({ startIndex: 1, hiddenPromptCount: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/compactHistoryWindow.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
export interface CompactHistoryWindow {
  startIndex: number;
  hiddenPromptCount: number;
}

type RoleOnly = { role: string };

export function getCurrentPromptWindow(messages: readonly RoleOnly[]): CompactHistoryWindow {
  if (messages.length === 0) return { startIndex: 0, hiddenPromptCount: 0 };

  let startIndex = messages.length - 1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      startIndex = i;
      break;
    }
  }

  let hiddenPromptCount = 0;
  for (let i = 0; i < startIndex; i++) {
    if (messages[i]?.role === "user") hiddenPromptCount++;
  }

  return { startIndex, hiddenPromptCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/compactHistoryWindow.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/compactHistoryWindow.ts \
  tracker/src/components/assistant/__tests__/compactHistoryWindow.test.ts
git commit -m "$(cat <<'EOF'
feat(assistant): add compact history window helper

Summary:
- Port Jean-style current-prompt window (startIndex + hiddenPromptCount).

Rationale:
- Default transcript should show only the active run.

Tests:
- vitest compactHistoryWindow.test.ts

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 2: Message scroll anchor (pure TS)

**Files:**

- Create: `tracker/src/components/assistant/messageScrollAnchor.ts`
- Test: `tracker/src/components/assistant/__tests__/messageScrollAnchor.test.ts`

- [ ] **Step 1: Write the failing test**

Mirror Jean’s `message-scroll-anchor.test.ts`: create a container with `[data-message-anchor-id]` children, mock `getBoundingClientRect`, assert `capturePrependScrollAnchor` returns `{ messageId, offsetTop }` and `restorePrependScrollAnchor` adjusts `scrollTop` so the anchored message keeps its viewport offset.

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/messageScrollAnchor.test.ts`

- [ ] **Step 3: Implement**

```ts
export interface PrependScrollAnchor {
  messageId: string;
  offsetTop: number;
}

const SELECTOR = "[data-message-anchor-id]";

export function capturePrependScrollAnchor(container: HTMLElement): PrependScrollAnchor | null {
  const containerRect = container.getBoundingClientRect();
  const elements = Array.from(container.querySelectorAll<HTMLElement>(SELECTOR));
  const firstVisible = elements.find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
  });
  if (!firstVisible) return null;
  const messageId = firstVisible.dataset.messageAnchorId;
  if (!messageId) return null;
  return {
    messageId,
    offsetTop: firstVisible.getBoundingClientRect().top - containerRect.top,
  };
}

export function restorePrependScrollAnchor(
  container: HTMLElement,
  anchor: PrependScrollAnchor | null,
): void {
  if (!anchor) return;
  const el = Array.from(container.querySelectorAll<HTMLElement>(SELECTOR)).find(
    (node) => node.dataset.messageAnchorId === anchor.messageId,
  );
  if (!el) return;
  const offsetAfter =
    el.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += offsetAfter - anchor.offsetTop;
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/messageScrollAnchor.ts \
  tracker/src/components/assistant/__tests__/messageScrollAnchor.test.ts
git commit -m "$(cat <<'EOF'
feat(assistant): add prepend scroll message anchors

Summary:
- Capture/restore viewport offset by data-message-anchor-id.

Rationale:
- Height-delta scroll restore jumps when older prompts expand.

Tests:
- vitest messageScrollAnchor.test.ts

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 3: Content-block helpers (TS) + streaming updates

**Files:**

- Create: `tracker/src/components/assistant/contentBlocks.ts`
- Modify: `tracker/src/components/assistant/assistantStream.ts`
- Modify: `tracker/src/services/assistant.ts` (types + normalize — can land types here early)
- Test: `tracker/src/components/assistant/__tests__/contentBlocks.test.ts`
- Modify: `tracker/src/components/assistant/__tests__/assistantStream.test.ts`

- [ ] **Step 1: Add types to `assistant.ts`**

```ts
export type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "tool"; toolCallId: string };

export interface AssistantChatMessage {
  id: string;
  role: AssistantChatRole;
  content: string;
  toolCalls: AssistantToolCall[];
  contentBlocks?: AssistantContentBlock[];
  // ...existing fields
}
```

In `normalizeAssistantChatMessage`:

```ts
contentBlocks: normalizeContentBlocks(dto.contentBlocks ?? dto.content_blocks),
```

```ts
function normalizeContentBlocks(raw: unknown): AssistantContentBlock[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const blocks: AssistantContentBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type === "text" && typeof row.text === "string") {
      blocks.push({ type: "text", text: row.text });
      continue;
    }
    if (row.type === "tool") {
      const id = row.toolCallId ?? row.tool_call_id;
      if (typeof id === "string" && id.trim() !== "") {
        blocks.push({ type: "tool", toolCallId: id });
      }
    }
  }
  return blocks.length > 0 ? blocks : undefined;
}
```

- [ ] **Step 2: Failing tests for helpers + stream**

```ts
// contentBlocks.test.ts
import { appendTextBlock, pushToolBlock } from "@/components/assistant/contentBlocks";

it("merges into the last text block", () => {
  expect(appendTextBlock([{ type: "text", text: "Hi" }], " there")).toEqual([
    { type: "text", text: "Hi there" },
  ]);
});

it("starts a new text block after a tool", () => {
  const withTool = pushToolBlock([{ type: "text", text: "A" }], "t1");
  expect(appendTextBlock(withTool, "B")).toEqual([
    { type: "text", text: "A" },
    { type: "tool", toolCallId: "t1" },
    { type: "text", text: "B" },
  ]);
});

it("does not duplicate an existing tool id", () => {
  const once = pushToolBlock([], "t1");
  expect(pushToolBlock(once, "t1")).toEqual(once);
});
```

Extend `assistantStream.test.ts`:

- `appendAssistantDelta` also grows `contentBlocks` text
- `updateStreamingToolCall` on first insert of a new id pushes a tool block; status-only updates do not add another block

- [ ] **Step 3: Run tests — expect FAIL**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/contentBlocks.test.ts src/components/assistant/__tests__/assistantStream.test.ts`

- [ ] **Step 4: Implement helpers**

```ts
// contentBlocks.ts
import type { AssistantContentBlock } from "@/services/assistant";

export function appendTextBlock(
  blocks: AssistantContentBlock[] | undefined,
  delta: string,
): AssistantContentBlock[] {
  if (!delta) return blocks ?? [];
  const next = [...(blocks ?? [])];
  const last = next[next.length - 1];
  if (last?.type === "text") {
    next[next.length - 1] = { type: "text", text: `${last.text}${delta}` };
    return next;
  }
  next.push({ type: "text", text: delta });
  return next;
}

export function pushToolBlock(
  blocks: AssistantContentBlock[] | undefined,
  toolCallId: string,
): AssistantContentBlock[] {
  if (!toolCallId.trim()) return blocks ?? [];
  const next = [...(blocks ?? [])];
  if (next.some((b) => b.type === "tool" && b.toolCallId === toolCallId)) return next;
  next.push({ type: "tool", toolCallId });
  return next;
}
```

Update `appendAssistantDelta` / `updateStreamingToolCall` to set `contentBlocks` via these helpers. For tool updates: only `pushToolBlock` when the tool id was not already in `toolCalls` (new insert).

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add tracker/src/services/assistant.ts \
  tracker/src/components/assistant/contentBlocks.ts \
  tracker/src/components/assistant/assistantStream.ts \
  tracker/src/components/assistant/__tests__/contentBlocks.test.ts \
  tracker/src/components/assistant/__tests__/assistantStream.test.ts
git commit -m "$(cat <<'EOF'
feat(assistant): stream and normalize content_blocks

Summary:
- Add AssistantContentBlock helpers and keep blocks in sync while streaming.

Rationale:
- Live UI must interleave before history sync; normalize enables reload.

Tests:
- vitest contentBlocks + assistantStream

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 4: Elixir `ContentBlocks` + collector + history payload

**Files:**

- Create: `elixir/lib/symphony_elixir/assistant/content_blocks.ex`
- Test: `elixir/test/symphony_elixir/assistant/content_blocks_test.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex` (collector init + relay paths)
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex` (`message_payload/1`, `append_message` metadata merge)
- Add/extend history tests that assert `content_blocks` in payload

- [ ] **Step 1: Failing ExUnit for pure module**

```elixir
defmodule SymphonyElixir.Assistant.ContentBlocksTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.ContentBlocks

  test "appends text into the last text block" do
    assert ContentBlocks.append_text([%{"type" => "text", "text" => "Hi"}], "!") ==
             [%{"type" => "text", "text" => "Hi!"}]
  end

  test "pushes tool block by id without duplicates" do
    blocks = ContentBlocks.push_tool([%{"type" => "text", "text" => "A"}], "t1")
    assert blocks == [
             %{"type" => "text", "text" => "A"},
             %{"type" => "tool", "tool_call_id" => "t1"}
           ]
    assert ContentBlocks.push_tool(blocks, "t1") == blocks
  end
end
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd elixir && mix test test/symphony_elixir/assistant/content_blocks_test.exs`

- [ ] **Step 3: Implement module**

```elixir
defmodule SymphonyElixir.Assistant.ContentBlocks do
  @moduledoc false

  @spec append_text([map()], String.t()) :: [map()]
  def append_text(blocks, delta) when is_list(blocks) and is_binary(delta) do
    if delta == "" do
      blocks
    else
      case List.last(blocks) do
        %{"type" => "text", "text" => text} ->
          List.replace_at(blocks, length(blocks) - 1, %{"type" => "text", "text" => text <> delta})

        _ ->
          blocks ++ [%{"type" => "text", "text" => delta}]
      end
    end
  end

  @spec push_tool([map()], String.t() | nil) :: [map()]
  def push_tool(blocks, id) when is_list(blocks) and is_binary(id) do
    id = String.trim(id)

    cond do
      id == "" ->
        blocks

      Enum.any?(blocks, &match?(%{"type" => "tool", "tool_call_id" => ^id}, &1)) ->
        blocks

      true ->
        blocks ++ [%{"type" => "tool", "tool_call_id" => id}]
    end
  end

  def push_tool(blocks, _), when is_list(blocks), do: blocks
end
```

- [ ] **Step 4: Wire collector in `agent_session.ex`**

Change collector init:

```elixir
Agent.start_link(fn -> %{assistant_message: "", tool_calls: [], content_blocks: []} end)
```

On text delta path (after concatenating `assistant_message`):

```elixir
%{
  state
  | assistant_message: state.assistant_message <> delta,
    content_blocks: ContentBlocks.append_text(state.content_blocks, delta)
}
```

On tool start / first upsert of a new tool id (both FileActivity and `:tool_call_started` / completed paths that insert a new id):

```elixir
content_blocks = ContentBlocks.push_tool(state.content_blocks, tool_id)
```

Include in returned result map:

```elixir
|> Map.put(:content_blocks, collected.content_blocks)
```

Wherever the assistant message is appended to history, pass:

```elixir
metadata: Map.put(existing_metadata, "content_blocks", content_blocks)
```

(Find the `History.append_message` call sites for the assistant turn in `agent_session.ex` / channel and thread `content_blocks` through.)

- [ ] **Step 5: Expose in `History.message_payload/1`**

```elixir
def message_payload(%Message{} = message) do
  %{
    id: message.id,
    role: message.role,
    content: message.content,
    sequence: message.sequence,
    turn_id: message.turn_id,
    tool_calls: tool_calls(message),
    content_blocks: content_blocks(message),
    metadata: message.metadata || %{},
    inserted_at: message.inserted_at
  }
end

defp content_blocks(%Message{metadata: %{"content_blocks" => blocks}}) when is_list(blocks), do: blocks
defp content_blocks(%Message{metadata: %{content_blocks: blocks}}) when is_list(blocks), do: blocks
defp content_blocks(_), do: []
```

Add a focused history test: append assistant message with metadata content_blocks → `message_payload` returns them.

- [ ] **Step 6: Run tests**

Run:

```bash
cd elixir && mix test test/symphony_elixir/assistant/content_blocks_test.exs
# plus the history test file you extended
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add elixir/lib/symphony_elixir/assistant/content_blocks.ex \
  elixir/test/symphony_elixir/assistant/content_blocks_test.exs \
  elixir/lib/symphony_elixir/assistant/agent_session.ex \
  elixir/lib/symphony_elixir/assistant/history.ex \
  elixir/test/symphony_elixir/assistant/*history*
git commit -m "$(cat <<'EOF'
feat(assistant): persist ordered content_blocks on turns

Summary:
- Collector builds text/tool blocks; history exposes content_blocks from metadata.

Rationale:
- Server is authoritative so reload and other tabs keep interleaving.

Tests:
- mix test content_blocks (+ history payload assertion)

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 5: `useAssistantScroll` (replace stickiness)

**Files:**

- Create: `tracker/src/components/assistant/useAssistantScroll.ts`
- Test: `tracker/src/components/assistant/__tests__/useAssistantScroll.test.ts`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (wire in Task 6; this task can ship hook + unit tests only)
- Delete or stop importing: `chatScrollStickiness.ts` after panel migrates

Constants (match Jean):

```ts
export const BOTTOM_THRESHOLD_PX = 100;
export const SCROLL_EPSILON_PX = 2;
export const SCROLL_UP_COOLDOWN_MS = 1000;
```

- [ ] **Step 1: Write failing DOM tests** (same FakeResizeObserver pattern as `chatScrollStickiness.test.ts`)

Cover:

1. While following + turn running, content resize → `scrollTop` pinned to tail.
2. Wheel `deltaY < 0` with overflow → stops following; further resize does **not** scroll.
3. Non-overflow viewport + wheel up → still following / `isAtBottom` true.
4. `scrollToBottom()` sets following and scrolls to tail; after cooldown expiry + at bottom, follow resumes.
5. `markAtBottom()` sets following without requiring scroll.

Export either the hook or an `attachAssistantScroll(viewport, { isRunningRef, onAtBottomChange })` used by the hook — prefer testing the attach/helpers layer the hook calls.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement hook**

Public API:

```ts
export function useAssistantScroll(options: {
  isRunning: boolean;
  threadKey: string | number | null; // reset on switch
}): {
  setScrollContainerRef: (node: HTMLDivElement | null) => void;
  isAtBottom: boolean;
  scrollToBottom: (instant?: boolean) => void;
  markAtBottom: () => void;
};
```

Internal refs (Jean model): `isFollowingTailRef`, `isAutoScrollingRef`, `userScrollUpUntilRef`, `lastScrollTopRef`.

Behaviors to port from Jean `useScrollManagement` (skip plan-pinning + findings):

- wheel / touch detach + cooldown
- ResizeObserver follow while `isRunning && following`
- smooth scroll on running rising edge if following; `scrollend` + 400ms fallback undershoot fix
- double-rAF pin when running falls and still following
- `useLayoutEffect` on `threadKey` → instant `scrollToTail` + reset follow
- `handleScroll`: ignore while `isAutoScrolling`; scroll-up clears follow; at-bottom clears cooldown

Keep the existing Bottom button in the panel; call `scrollToBottom()`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/useAssistantScroll.ts \
  tracker/src/components/assistant/__tests__/useAssistantScroll.test.ts
git commit -m "$(cat <<'EOF'
feat(assistant): add Jean-style follow-tail scroll hook

Summary:
- Separate following vs at-bottom; cooldown; rAF resize follow; scrollend fix.

Rationale:
- Current stickiness fights scroll-up and undershoots after stream end.

Tests:
- vitest useAssistantScroll.test.ts

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 6: Wire scroll + compact history in the panel / list

**Files:**

- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Modify: `tracker/src/components/assistant/AssistantMessageList.tsx`
- Modify: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`
- Tests: extend panel / message-list tests

- [ ] **Step 1: i18n keys** under `assistant.panel`:

```json
"loadOldPrompts": "↑ Load old prompts ({{count}})",
"loadOldPromptsEmpty": "↑ Load old prompts"
```

pt-BR:

```json
"loadOldPrompts": "↑ Carregar prompts antigos ({{count}})",
"loadOldPromptsEmpty": "↑ Carregar prompts antigos"
```

- [ ] **Step 2: Extend `AssistantMessageList` props**

```ts
hiddenPromptCount?: number;
expandedHistory?: boolean;
onLoadOldPrompts?: () => void;
```

Render above messages when `!expandedHistory && hiddenPromptCount > 0`:

```tsx
<button type="button" className="w-full py-2 text-center text-xs text-muted-foreground ..." onClick={onLoadOldPrompts}>
  {t("assistant.panel.loadOldPrompts", { count: hiddenPromptCount })}
</button>
```

On each bubble wrapper / bubble root, set `data-message-anchor-id={message.id}`.

- [ ] **Step 3: Panel state**

```ts
const [expandedHistory, setExpandedHistory] = useState(false);
const window = getCurrentPromptWindow(messages);
const visibleMessages = expandedHistory ? messages : messages.slice(window.startIndex);
```

On send (`sendMessage` / `dispatchSend` entry): `setExpandedHistory(false)` + `markAtBottom()`.

Replace `attachChatScrollStickiness` / `stickToBottomRef` / `pinnedScrollTopRef` / manual scroll effects with `useAssistantScroll({ isRunning, threadKey: threadId })`.

History apply when not following: capture anchor before setState, restore in `useLayoutEffect` (or keep `setMessagesPreservingScroll` but prefer anchor when expanding older in-memory — for expand, just set `expandedHistory true` and restore anchor).

Remove obsolete scroll `useEffect` that double-scrolls on `visibleMessages` if the hook owns follow.

- [ ] **Step 4: Tests**

- Message list shows load button with count; click calls handler.
- Panel: with 2 user turns, only latest run visible until expand.
- Send path calls mark-at-bottom (mock hook or spy).

- [ ] **Step 5: Run**

```bash
cd tracker && npx vitest run src/components/assistant/__tests__/
```

- [ ] **Step 6: Delete dead `chatScrollStickiness.ts` + its test** once nothing imports them; commit with panel wire-up.

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/assistant/AssistantMessageList.tsx \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json \
  tracker/src/components/assistant/chatScrollStickiness.ts \
  tracker/src/components/assistant/__tests__/chatScrollStickiness.test.ts \
  tracker/src/components/assistant/__tests__/*
git commit -m "$(cat <<'EOF'
feat(assistant): wire follow-tail scroll and compact history

Summary:
- Panel uses useAssistantScroll; list defaults to current prompt with Load old prompts.

Rationale:
- Delivers Jean density + scroll behavior in the assistant shell.

Tests:
- vitest assistant component suite

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 7: `AssistantTurnTimeline` + bubble fallback

**Files:**

- Create: `tracker/src/components/assistant/AssistantTurnTimeline.tsx`
- Test: `tracker/src/components/assistant/__tests__/AssistantTurnTimeline.test.tsx`
- Modify: `tracker/src/components/assistant/AssistantChatMessageBubble.tsx`

- [ ] **Step 1: Failing component tests**

1. With `contentBlocks` `[text, tool, text]` and matching `toolCalls`, render order is text → tool item → text (query by text / test ids).
2. Without `contentBlocks` but with `toolCalls`, legacy layout: full markdown then tools section (existing border-t timeline).
3. Tool-only blocks render tool without requiring text.

- [ ] **Step 2: Implement timeline**

```tsx
export function AssistantTurnTimeline({
  blocks,
  toolCalls,
  taskSnapshot,
  onKillTool,
  onOpenDocumentPath,
}: {
  blocks: AssistantContentBlock[];
  toolCalls: AssistantToolCall[];
  // ...same optional props as bubble needs for markdown/tools
}) {
  const byId = new Map(toolCalls.filter((c) => c.id).map((c) => [c.id as string, c]));

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === "text") {
          return (
            <AssistantMarkdown
              key={`text-${index}`}
              content={block.text}
              onOpenDocumentPath={onOpenDocumentPath}
            />
          );
        }
        const call = byId.get(block.toolCallId);
        if (!call) return null;
        return (
          <ToolActivityTimeline
            key={`tool-${block.toolCallId}`}
            toolCalls={[call]}
            taskSnapshot={taskSnapshot}
            onKillTool={onKillTool}
          />
        );
      })}
    </div>
  );
}
```

In bubble assistant branch:

```tsx
{message.contentBlocks && message.contentBlocks.length > 0 ? (
  <AssistantTurnTimeline
    blocks={message.contentBlocks}
    toolCalls={message.toolCalls}
    ...
  />
) : (
  <>
    <AssistantMarkdown content={message.content} ... />
    {message.toolCalls.length ? (/* existing ToolActivityTimeline + EditedFilesSummary */) : null}
  </>
)}
```

For interleaved mode, still render `EditedFilesSummary` once after the timeline (derived from all `toolCalls`) so file chips are not lost.

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add tracker/src/components/assistant/AssistantTurnTimeline.tsx \
  tracker/src/components/assistant/AssistantChatMessageBubble.tsx \
  tracker/src/components/assistant/__tests__/AssistantTurnTimeline.test.tsx
git commit -m "$(cat <<'EOF'
feat(assistant): interleave tools with text via content_blocks

Summary:
- AssistantTurnTimeline renders ordered blocks; legacy messages keep end-stacked tools.

Rationale:
- Tools belong mid-turn like Jean, not always under a footer border.

Tests:
- vitest AssistantTurnTimeline.test.tsx

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

### Task 8: Channel normalize regression + end-to-end suite gate

**Files:**

- Modify: `tracker/src/services/phoenix/__tests__/assistantChannel.test.ts` (history fixture includes `content_blocks`)
- Modify: any Elixir channel/history integration test that asserts message JSON shape

- [ ] **Step 1: Extend channel test**

History payload message with:

```json
{
  "id": 1,
  "role": "assistant",
  "content": "Hello world",
  "tool_calls": [{ "id": "t1", "name": "list_issues", "status": "complete" }],
  "content_blocks": [
    { "type": "text", "text": "Hello " },
    { "type": "tool", "tool_call_id": "t1" },
    { "type": "text", "text": "world" }
  ]
}
```

Assert `onHistory` / normalized messages include camelCase `contentBlocks` with `toolCallId`.

- [ ] **Step 2: Run focused suites**

```bash
cd tracker && npx vitest run src/components/assistant/__tests__/ src/services/phoenix/__tests__/assistantChannel.test.ts src/services/__tests__/assistant.test.ts
cd elixir && mix test test/symphony_elixir/assistant/content_blocks_test.exs
```

Expected: all PASS

- [ ] **Step 3: Manual smoke (operator)**

On `http://localhost:4000/tracker/projects/macro-markets/workspaces/7999` (or any assistant thread):

1. Send a message → user bubble visible; stream follows.
2. Scroll up mid-stream → no forced jump; Bottom restores follow.
3. After complete → true bottom.
4. Second prompt → only current run visible; Load old prompts expands; send again re-compacts.
5. Tool-using turn → tools appear between text chunks; reload page → order preserved.

- [ ] **Step 4: Final commit if test-only deltas remain**

```bash
git add -u
git commit -m "$(cat <<'EOF'
test(assistant): cover content_blocks history normalize

Summary:
- Channel/history fixtures assert interleaved blocks round-trip.

Rationale:
- Guards reload parity for the timeline UX.

Tests:
- vitest assistantChannel + mix content_blocks

Co-authored-by: Codex <codex@openai.com>
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Follow-tail ≠ at-bottom; cooldown; scrollend; double-rAF end | 5, 6 |
| Non-overflow honesty; Bottom button | 5, 6 |
| Thread switch instant pin | 5 (`threadKey`) |
| Prepend message-id anchor | 2, 6 |
| Compact window + Load old prompts | 1, 6 |
| Re-compact on new user send | 6 |
| `content_blocks` types + client stream mirror | 3 |
| Elixir authoritative collector + persist metadata | 4 |
| History payload exposes blocks | 4, 8 |
| Interleaved render + legacy fallback | 7 |
| No virtualization / plan-pin / findings / Execution tab | explicitly out |
| Unit/component tests; no mandatory e2e | all tasks + Task 8 manual smoke |

## Placeholder / consistency notes

- Block shape: TS `{ type: "tool", toolCallId }` ↔ Elixir `%{"type" => "tool", "tool_call_id" => id}`; normalize accepts both.
- Storage: `metadata["content_blocks"]` only (no migration).
- Running flag: panel’s existing `isRunning` is Jean’s `isSending`.
- `EditedFilesSummary` remains once per assistant message after timeline in interleaved mode.
