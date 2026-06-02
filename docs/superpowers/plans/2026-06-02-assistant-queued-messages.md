# Assistant Queued Messages — Implementation Plan

**Goal:** Let the user type and submit messages while the assistant is running; messages queue locally as removable chips and auto-send sequentially when the current turn finishes (Cursor-style).

**Architecture:** Frontend-only. `AssistantComposer` stops disabling its textarea while running and reports a discriminated `kind` on submit. `ProjectAssistantPanel` keeps a local `queued` array: a `kind: "message"` submit while running is pushed to the queue instead of sent; on the running→idle edge (driven by `assistant_completed`/`assistant_error`) the next queued item is sent. Queue chips render between the transcript and the composer. A defensive server-side busy guard is added in the backend foundation plan, not here.

**Tech Stack:** React 19, Tailwind v4, lucide-react, vitest + @testing-library/react.

**Source of truth:** `docs/superpowers/specs/2026-06-02-assistant-chat-steering-queue-design.md` §4, §6.

**Dependency:** none (ships independently). The `kind` field added here is reused by the `/infer` and `/btw` plans.

---

## Task 1: Add `kind` to the composer submit contract

**Files:**
- Modify: `tracker/src/components/assistant/AssistantComposer.tsx` (`AssistantComposerSubmit` `:38-42`, `submitCurrent` `:148-162`, textarea `disabled` `:251`)
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (`sendMessage` `:307-338`, `onNew` `:340-354`)
- Test: `tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `AssistantComposer.test.tsx`:

```tsx
it("submits a default kind of 'message' with the typed text", async () => {
  const onSubmit = vi.fn();
  render(
    <AssistantComposer
      projectSlug="macro-markets"
      catalog={testCatalog}
      onSubmit={onSubmit}
    />,
  );

  const textarea = screen.getByPlaceholderText("Write a message...");
  fireEvent.change(textarea, { target: { value: "hello" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "message", message: "hello" }),
  );
});

it("keeps the textarea enabled while the assistant is running", () => {
  render(
    <AssistantComposer
      projectSlug="macro-markets"
      catalog={testCatalog}
      disabled
      onSubmit={vi.fn()}
    />,
  );

  expect(screen.getByPlaceholderText("Write a message...")).not.toBeDisabled();
});
```

If `testCatalog` is not already defined in the file, add this constant near the top of the test module (mirror the catalog shape from `ProjectAssistantPanel.test.tsx:43-58`):

```tsx
const testCatalog = {
  agent: "codex" as const,
  agentLabel: "Codex CLI",
  command: "codex app-server",
  defaultModel: "gpt-5.3-codex",
  models: [
    {
      id: "gpt-5.3-codex",
      model: "gpt-5.3-codex",
      label: "GPT-5.3 Codex",
      isDefault: true,
      defaultEffort: "low",
      efforts: [{ id: "low", label: "Low" }],
    },
  ],
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/AssistantComposer.test.tsx`
Expected: FAIL — `onSubmit` called without a `kind` property; textarea is disabled.

- [ ] **Step 3: Update the submit type**

In `AssistantComposer.tsx`, replace the `AssistantComposerSubmit` interface (`:38-42`):

```tsx
export type AssistantComposerSubmitKind = "message" | "infer" | "btw";

export interface AssistantComposerSubmit {
  kind: AssistantComposerSubmitKind;
  message: string;
  settings: AssistantComposerSettings;
  attachments: ReturnType<typeof serializeAttachments>;
}
```

- [ ] **Step 4: Emit `kind` and stop disabling the textarea**

In `submitCurrent` (`:148-162`), change the `onSubmit` call to include `kind: "message"`:

```tsx
  function submitCurrent() {
    if (!canSend) return;

    onSubmit({
      kind: "message",
      message: input,
      settings,
      attachments: serializeAttachments(attachments),
    });

    revokeAttachmentPreviews(attachments);
    setInput("");
    setAttachments([]);
    recordingRef.current = false;
    stopSpeechRecognition();
  }
```

Update `canSend` (`:103-107`) so a running turn no longer blocks typing/sending (the panel decides whether to queue or send):

```tsx
  const canSend = !recording && !uploadingImage && (input.trim().length > 0 || attachments.length > 0);
```

Remove `disabled` from the `Textarea` (`:251`) so queued typing is possible while running:

```tsx
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          className="min-h-[4.5rem] resize-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0"
        />
```

(Leave the model/effort/voice/image controls' `disabled={disabled}` flags unchanged — only the textarea and send path change.)

- [ ] **Step 5: Update `ProjectAssistantPanel` callers to the new shape**

In `ProjectAssistantPanel.tsx`, update `onNew` (`:347-351`) to pass `kind`:

```tsx
      sendMessage({
        kind: "message",
        message: firstPart.text,
        settings: defaultComposerSettings(activeCatalog),
        attachments: [],
      });
```

(`sendMessage` itself is rewritten in Task 2; for now make it accept the new field by destructuring `kind` even if unused, so the type-check passes.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/AssistantComposer.test.tsx && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add tracker/src/components/assistant/AssistantComposer.tsx tracker/src/components/assistant/ProjectAssistantPanel.tsx tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx
git commit -m "feat(tracker): add submit kind and keep composer typeable while running"
```

---

## Task 2: Queue messages in `ProjectAssistantPanel`

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (state `:96-111`, `sendMessage` `:307-338`, render `:390-398`)
- Test: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `ProjectAssistantPanel.test.tsx`:

```tsx
it("queues a message submitted while running and auto-sends it on completion", async () => {
  render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

  const textarea = screen.getByPlaceholderText("Write a message...");

  // First message -> sent immediately, marks running.
  fireEvent.change(textarea, { target: { value: "first" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "first" })),
  );
  channelHandlers["assistant_delta"]({ delta: "working" }); // isRunning = true

  // Second message while running -> queued, not sent.
  fireEvent.change(textarea, { target: { value: "second" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

  expect(await screen.findByText("second")).toBeTruthy(); // chip visible
  expect(push).not.toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "second" }));

  // First turn completes -> queued "second" is auto-sent.
  channelHandlers["assistant_completed"]({ message: { id: 9, role: "assistant", content: "done", tool_calls: [] } });

  await waitFor(() =>
    expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "second" })),
  );
});

it("removes a queued message when its chip remove button is clicked", async () => {
  render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
  const textarea = screen.getByPlaceholderText("Write a message...");

  fireEvent.change(textarea, { target: { value: "first" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(push).toHaveBeenCalled());
  channelHandlers["assistant_delta"]({ delta: "working" });

  fireEvent.change(textarea, { target: { value: "queued one" } });
  fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

  const removeButton = await screen.findByRole("button", { name: /remove queued message/i });
  fireEvent.click(removeButton);

  await waitFor(() => expect(screen.queryByText("queued one")).toBeNull());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`
Expected: FAIL — "second" is sent immediately (no queue) / chip not found.

- [ ] **Step 3: Add queue state and types**

In `ProjectAssistantPanel.tsx`, add near the other `useState` declarations (`:96-101`):

```tsx
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
```

Add the type near the top-level helpers (e.g. just below `STREAMING_ASSISTANT_ID` at `:66`):

```tsx
interface QueuedMessage {
  id: string;
  payload: AssistantComposerSubmit;
}
```

Ensure `AssistantComposerSubmit` is imported (it already is, via `import { AssistantComposer, type AssistantComposerSubmit } from "@/components/assistant/AssistantComposer";` at `:11`).

- [ ] **Step 4: Route submits to queue while running**

Replace `sendMessage` (`:307-338`) with a version that queues `kind: "message"` while running and otherwise sends:

```tsx
  const dispatchSend = useCallback(
    (payload: AssistantComposerSubmit) => {
      const trimmed = payload.message.trim();
      const hasAttachments = payload.attachments.length > 0;
      if (!trimmed && !hasAttachments) return;

      const channel = channelRef.current;
      if (!channel) {
        setConnectionError("Assistant channel is not connected yet.");
        return;
      }

      const wirePayload = {
        message: trimmed || fallbackAttachmentMessage(payload.attachments),
        context: {
          view,
          agent: "codex",
          model: payload.settings.model,
          effort: payload.settings.effort,
        },
        attachments: payload.attachments,
      };

      setConnectionError(null);
      setIsRunning(true);
      channel.push("send_message", wirePayload).receive("error", (reason) => {
        setConnectionError(errorMessage(reason));
        setIsRunning(false);
      });
    },
    [view],
  );

  const sendMessage = useCallback(
    (payload: AssistantComposerSubmit) => {
      const trimmed = payload.message.trim();
      const hasAttachments = payload.attachments.length > 0;
      if (!trimmed && !hasAttachments) return;

      if (isRunning) {
        setQueued((current) => [...current, { id: crypto.randomUUID(), payload }]);
        return;
      }

      dispatchSend(payload);
    },
    [dispatchSend, isRunning],
  );
```

- [ ] **Step 5: Drain the queue on the running→idle edge**

Add an effect after `sendMessage` (uses a ref to detect the transition and avoid double-sends):

```tsx
  const wasRunningRef = useRef(false);
  useEffect(() => {
    const justFinished = wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;
    if (!justFinished || queued.length === 0) return;

    const [next, ...rest] = queued;
    setQueued(rest);
    dispatchSend(next.payload);
  }, [isRunning, queued, dispatchSend]);
```

- [ ] **Step 6: Render queue chips**

In `messageItems` is the transcript; add the chips between the scroller and the composer. In both panel layouts the composer is rendered via `composerNode`. Add a `queuedChips` node and render it directly above `composerNode` in the page layout (`:451-461`) and the non-page layout (`:465-472`) and the sheet layout (`:497`). Define it near `composerNode` (`:400`):

```tsx
  const queuedChips =
    queued.length > 0 ? (
      <div className="flex flex-col gap-1.5 px-4 pb-2">
        {queued.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
          >
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.payload.message.trim()}</span>
            <button
              type="button"
              aria-label="Remove queued message"
              onClick={() => setQueued((current) => current.filter((entry) => entry.id !== item.id))}
              className="rounded p-0.5 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    ) : null;
```

Add `Clock` and `X` to the lucide import (`:8`): `import { AudioLines, Bot, Clock, ImageIcon, X } from "lucide-react";`

Render `{queuedChips}` immediately before each `{composerNode ?? ...}` placement (page dock, panel, sheet).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx && npx tsc --noEmit`
Expected: PASS (new queue tests + existing tests green).

- [ ] **Step 8: Manual smoke check**

Send a message; while it streams, type and Enter a second — confirm it appears as a chip and is NOT sent. When the turn completes, confirm the chip disappears and the second message is sent. Confirm the X removes a chip.

- [ ] **Step 9: Commit**

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "feat(tracker): queue assistant messages submitted while running"
```

---

## Self-Review

- **Spec coverage (§6):** composer not disabled while running ✓ (Task 1 Step 4); submit-while-running queues ✓ (Task 2 Step 4); chips with remove ✓ (Task 2 Step 6); auto-send next on completion ✓ (Task 2 Step 5). Server busy guard is intentionally deferred to the backend-foundation plan (§6 note) — cross-referenced, not a gap.
- **Placeholder scan:** none — all steps contain code or exact commands.
- **Type consistency:** `AssistantComposerSubmit` gains `kind`/`AssistantComposerSubmitKind` in Task 1 Step 3 and is used in `QueuedMessage` (Task 2 Step 3) and `dispatchSend`/`sendMessage` (Task 2 Step 4) identically. `dispatchSend` is defined before `sendMessage` and the drain effect, matching usage order. `fallbackAttachmentMessage` and `errorMessage` already exist in the file (`:621`, `:722`).
- **Note:** `onNew` (Task 1 Step 5) calls `sendMessage` with `kind: "message"`; while running this now queues the assistant-ui `onNew` text, which is the intended unified behavior.
