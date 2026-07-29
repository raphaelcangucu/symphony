# Single Running Activity Implementation Plan

**Goal:** Render one Codex-style live command row instead of duplicating a running tool call in both the transcript and the global working indicator.

**Architecture:** Treat the transcript tool call as authoritative when its stable ID matches the active tool. Carry a small timing record keyed by tool-call ID through the existing message/timeline components so the row can show live and settled elapsed time; retain `WorkingIndicator` only as a fallback when no matching tool call has reached the transcript.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, i18next, Tailwind CSS.

---

### Task 1: Command presentation copy

**Files:**

- Modify: `tracker/src/components/assistant/fileActivity.ts`
- Modify: `tracker/src/components/assistant/FileActivityCard.tsx`
- Modify: `tracker/locales/en/tracker.json`
- Modify: `tracker/locales/pt-BR/tracker.json`
- Test: `tracker/src/components/assistant/__tests__/fileActivity.test.ts`
- Test: `tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx`

- [x] **Step 1: Write failing formatter and state-copy tests**

Add coverage that maps `/bin/zsh -lc 'sleep 10'` to the visible title
`sleep 10`, preserves unmatched commands, renders `Running` without a second
status badge while active, and renders `Ran` after completion.

```ts
it("removes the standard zsh launcher from a command title", () => {
  const view = fileActivityFromToolCall(
    call({
      name: "shell",
      status: "running",
      arguments: { command: "/bin/zsh -lc 'sleep 10'" },
    }),
  );
  expect(view?.title).toBe("sleep 10");
});

it("uses one state-aware command verb", () => {
  renderWithI18n(
    <FileActivityCard
      view={view({ kind: "command", title: "sleep 10", status: "running" })}
    />,
  );
  expect(screen.getByText("Running")).toBeInTheDocument();
  expect(screen.queryByText(/^running$/i)).toBeInTheDocument();
  expect(screen.queryAllByText(/^running$/i)).toHaveLength(1);
});
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd tracker
npm test -- --run fileActivity.test.ts FileActivityCard.test.tsx
```

Expected: failures for the unstripped wrapper and missing progressive command
verb.

- [x] **Step 3: Implement the minimal command formatter and copy**

Add a display-only formatter that recognizes only the exact standard wrapper:

```ts
function commandDisplayTitle(command: string): string {
  const match = command.match(/^\/bin\/zsh -lc '([\s\S]*)'$/);
  return match?.[1] ?? command;
}
```

Keep the original command in the existing serialized tool input. In
`FileActivityCard`, choose `Running` for a running command and `Ran` for a
settled command, and omit the redundant running status label for command rows.
Add localized strings:

```json
"commandRunning": "Running",
"commandComplete": "Ran"
```

and:

```json
"commandRunning": "Executando",
"commandComplete": "Executou"
```

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
cd tracker
npm test -- --run fileActivity.test.ts FileActivityCard.test.tsx
```

Expected: both files pass.

- [x] **Step 5: Commit Task 1**

```bash
git add tracker/src/components/assistant/fileActivity.ts \
  tracker/src/components/assistant/FileActivityCard.tsx \
  tracker/src/components/assistant/__tests__/fileActivity.test.ts \
  tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx \
  tracker/locales/en/tracker.json tracker/locales/pt-BR/tracker.json
git commit -m "refactor(assistant): clarify live command copy"
```

### Task 2: Single authoritative running row

**Files:**

- Modify: `tracker/src/components/assistant/AssistantMessageList.tsx`
- Test: `tracker/src/components/assistant/__tests__/AssistantMessageList.test.tsx`

- [x] **Step 1: Write failing duplicate/fallback tests**

Render a running message with tool ID `tool-1` and matching
`activeToolDetail.id`. Assert that there is no global `role="status"` below the
transcript. Add a second case where the active tool snapshot exists but the
message has not arrived; assert that `WorkingIndicator` remains visible.

```tsx
expect(screen.queryByRole("status")).not.toBeInTheDocument();
expect(screen.getAllByText(/^Running$/i)).toHaveLength(1);
```

Fallback:

```tsx
expect(screen.getByRole("status")).toHaveTextContent(
  /Running shell.*sleep 10/i,
);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd tracker
npm test -- --run AssistantMessageList.test.tsx
```

Expected: the matching tool case finds the duplicate global status.

- [x] **Step 3: Suppress only a represented active tool**

Derive the rendered messages from the selected body source and match the live
call by stable ID, falling back to name only for legacy ID-less calls:

```ts
function containsActiveTool(
  messages: readonly AssistantChatMessage[],
  active: WorkingActiveToolDetail | null,
): boolean {
  if (!active) return false;
  return messages.some((message) =>
    message.toolCalls.some(
      (call) =>
        call.status === "running" &&
        (call.id ? call.id === active.id : call.name === active.name),
    ),
  );
}
```

Render `WorkingIndicator` only when the turn is running and
`containsActiveTool(...)` is false. This preserves the global fallback during
thinking, transport delay, and ID mismatch.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd tracker
npm test -- --run AssistantMessageList.test.tsx
```

Expected: duplicate and fallback cases pass.

- [x] **Step 5: Commit Task 2**

```bash
git add tracker/src/components/assistant/AssistantMessageList.tsx \
  tracker/src/components/assistant/__tests__/AssistantMessageList.test.tsx
git commit -m "fix(assistant): avoid duplicate running activity"
```

### Task 3: Live and settled timing

**Files:**

- Modify: `tracker/src/components/assistant/WorkingIndicator.tsx`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Modify: `tracker/src/components/assistant/AssistantMessageList.tsx`
- Modify: `tracker/src/components/assistant/AssistantChatMessageBubble.tsx`
- Modify: `tracker/src/components/assistant/AssistantTurnTimeline.tsx`
- Modify: `tracker/src/components/agent-activity/ToolActivityTimeline.tsx`
- Modify: `tracker/src/components/agent-activity/ToolActivityItem.tsx`
- Modify: `tracker/src/components/assistant/FileActivityCard.tsx`
- Test: `tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx`
- Test: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx`

- [x] **Step 1: Write failing timing tests**

Use fake timers to assert that an active command row advances from `· 0:00` to
`· 0:03`. Render a completed row with `durationMs={10_000}` and assert `· 10s`.
Add a panel test that verifies the server active-tool `started_at` is associated
with the matching transcript tool ID.

```tsx
renderWithI18n(
  <FileActivityCard
    view={view({ kind: "command", title: "sleep 10", status: "running" })}
    startedAt={Date.now()}
  />,
);
expect(screen.getByText("· 0:00")).toBeInTheDocument();
```

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd tracker
npm test -- --run FileActivityCard.test.tsx ProjectAssistantPanel.test.tsx
```

Expected: `FileActivityCard` rejects/ignores timing props and no elapsed copy is
rendered.

- [x] **Step 3: Introduce the timing contract**

Extend the active detail and create a shared timing shape:

```ts
export interface ToolActivityTiming {
  startedAt: number;
  durationMs: number | null;
}

export interface WorkingActiveToolDetail {
  id: string;
  name: string;
  argumentsSummary: string | null;
  startedAt?: number | null;
}
```

In `ProjectAssistantPanel`, retain timing by stable ID. Capture the normalized
server start timestamp while active; if it is absent, begin at the first client
detection of the tool rather than inheriting the older turn start. Finalize
duration when the matching message tool call settles. Return the previous state
object when no entry changes to avoid effect loops.

- [x] **Step 4: Carry timing through the existing timeline boundary**

Pass `toolTimings` through:

```text
AssistantMessageList
  -> AssistantChatMessageBubble
  -> AssistantTurnTimeline / ToolActivityTimeline
  -> ToolActivityItem
  -> FileActivityCard
```

Only the matching stable tool-call ID receives its timing. In
`FileActivityCard`, use `useNowTick` with `formatClockElapsed` while running and
`formatDurationSeconds` after completion.

- [x] **Step 5: Run focused and regression tests**

Run:

```bash
cd tracker
npm test -- --run FileActivityCard.test.tsx AssistantMessageList.test.tsx \
  AssistantTurnTimeline.test.tsx ToolActivityTimeline.test.tsx \
  ProjectAssistantPanel.test.tsx
```

Expected: all selected suites pass.

- [x] **Step 6: Commit Task 3**

```bash
git add tracker/src/components/assistant/WorkingIndicator.tsx \
  tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/assistant/AssistantMessageList.tsx \
  tracker/src/components/assistant/AssistantChatMessageBubble.tsx \
  tracker/src/components/assistant/AssistantTurnTimeline.tsx \
  tracker/src/components/agent-activity/ToolActivityTimeline.tsx \
  tracker/src/components/agent-activity/ToolActivityItem.tsx \
  tracker/src/components/assistant/FileActivityCard.tsx \
  tracker/src/components/assistant/__tests__/FileActivityCard.test.tsx \
  tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "feat(assistant): show command activity timing"
```

### Task 4: Verification and visual evidence

**Files:**

- Modify: `docs/superpowers/plans/2026-07-29-single-running-activity-plan.md`
- Create: `.symphony/evidence/artifacts/screens/composer-single-running-activity-desktop.jpg`
- Create: `.symphony/evidence/artifacts/screens/composer-single-running-activity-mobile.jpg`
- Create: `.symphony/evidence/artifacts/screens/composer-single-running-activity-disclosure.jpg`
- Create: `.symphony/evidence/artifacts/videos/composer-single-running-activity-e2e.mp4`

- [x] **Step 1: Run formatting and the focused suite**

```bash
cd tracker
npx prettier --check \
  src/components/assistant \
  src/components/agent-activity \
  locales/en/tracker.json locales/pt-BR/tracker.json
npm test -- --run FileActivityCard.test.tsx AssistantMessageList.test.tsx \
  AssistantTurnTimeline.test.tsx ToolActivityTimeline.test.tsx \
  ProjectAssistantPanel.test.tsx
```

Result: formatter exited zero and 137 focused tests passed across 9 files.

- [x] **Step 2: Build production assets**

```bash
cd tracker
npm run build
```

Result: TypeScript and Vite production build exited zero.

- [x] **Step 3: Validate in the real app**

Open the existing local tracker, start a command such as `sleep 10`, and verify:

1. one visible running row;
2. concise command copy;
3. one elapsed timer;
4. Kill on the command row;
5. Stop only in the composer;
6. completed copy changes to Ran.

Captured the active state at desktop and mobile widths, the raw-command
disclosure, plus a 17.5-second E2E video covering compose, running, and
completed states.

- [x] **Step 4: Update the plan checklist and commit**

Mark completed plan steps and commit the plan plus any final test-only
adjustment:

```bash
git add docs/superpowers/plans/2026-07-29-single-running-activity-plan.md
git commit -m "docs(assistant): record running activity validation"
```
