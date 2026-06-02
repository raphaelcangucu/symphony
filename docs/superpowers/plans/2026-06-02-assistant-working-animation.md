# Assistant Working Animation — Implementation Plan

**Goal:** Replace the static `Assistant is working...` line with an animated indicator (spinner + rotating verbs + elapsed timer + active tool name), in the style of Claude Code / Codex.

**Architecture:** A self-contained React component `WorkingIndicator` renders a spinner, a label, and an `m:ss` elapsed timer. The label shows the active tool name when a tool call is running, otherwise a verb that rotates every ~3s. `ProjectAssistantPanel` tracks when the run started and derives the active tool from the streaming message, then renders the component while `isRunning`. Honors `prefers-reduced-motion`.

**Tech Stack:** React 19, Tailwind v4, lucide-react icons. No backend changes.

**Source of truth:** `docs/superpowers/specs/2026-06-02-assistant-chat-steering-queue-design.md` §5.

---

## Task 1: `WorkingIndicator` component

**Files:**
- Create: `tracker/src/components/assistant/WorkingIndicator.tsx`
- Test: `tracker/src/components/assistant/__tests__/WorkingIndicator.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkingIndicator } from "../WorkingIndicator";

describe("WorkingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an elapsed timer starting at 0:00", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool={null} />);
    expect(screen.getByText(/0:00/)).toBeInTheDocument();
  });

  it("increments the elapsed timer every second", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool={null} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/0:03/)).toBeInTheDocument();
  });

  it("shows the active tool name when a tool is running", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool="update_issue" />);
    expect(screen.getByText(/Running update_issue/)).toBeInTheDocument();
  });

  it("exposes a polite live region for assistive tech", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/WorkingIndicator.test.tsx`
Expected: FAIL — `Failed to resolve import "../WorkingIndicator"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const WORKING_VERBS = [
  "Pondering",
  "Cooking",
  "Wrangling tokens",
  "Consulting the codex",
  "Untangling threads",
  "Spelunking the repo",
  "Composing",
  "Crunching",
  "Plotting",
] as const;

const VERB_ROTATION_MS = 3000;

interface WorkingIndicatorProps {
  startedAt: number;
  activeTool?: string | null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function WorkingIndicator({ startedAt, activeTool }: WorkingIndicatorProps) {
  const reducedMotion = useRef(prefersReducedMotion());
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);
  const [verbIndex, setVerbIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    if (reducedMotion.current) return;
    const id = window.setInterval(
      () => setVerbIndex((current) => (current + 1) % WORKING_VERBS.length),
      VERB_ROTATION_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const label = activeTool ? `Running ${activeTool}` : WORKING_VERBS[verbIndex];

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2
        aria-hidden="true"
        className={cn("h-3.5 w-3.5", reducedMotion.current ? "opacity-70" : "animate-spin")}
      />
      <span>{label}…</span>
      <span className="tabular-nums text-xs opacity-70">· {formatElapsed(elapsedMs)}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tracker && npx vitest run src/components/assistant/__tests__/WorkingIndicator.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint/type-check**

Run: `cd tracker && npx tsc --noEmit && npx eslint src/components/assistant/WorkingIndicator.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/assistant/WorkingIndicator.tsx tracker/src/components/assistant/__tests__/WorkingIndicator.test.tsx
git commit -m "feat(tracker): add animated WorkingIndicator for assistant chat"
```

---

## Task 2: Wire `WorkingIndicator` into `ProjectAssistantPanel`

**Files:**
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (state near `:96`, render at `:396`)

- [ ] **Step 1: Add the import**

At the top of `ProjectAssistantPanel.tsx`, alongside the existing `@/components/assistant/...` imports:

```tsx
import { WorkingIndicator } from "@/components/assistant/WorkingIndicator";
```

- [ ] **Step 2: Track when the run started**

Add state next to `const [isRunning, setIsRunning] = useState(false);` (`:96`):

```tsx
const [runningStartedAt, setRunningStartedAt] = useState<number | null>(null);
```

Add an effect (place it right after the `isRunning` state declarations, before the catalog effect at `:119`):

```tsx
useEffect(() => {
  setRunningStartedAt((current) => {
    if (isRunning) return current ?? Date.now();
    return null;
  });
}, [isRunning]);
```

- [ ] **Step 3: Derive the active tool from the streaming message**

Add this just before `const messageItems = (` (`:390`):

```tsx
const activeTool =
  messages
    .find((message) => message.id === STREAMING_ASSISTANT_ID)
    ?.toolCalls.find((toolCall) => toolCall.status === "running")?.name ?? null;
```

- [ ] **Step 4: Replace the static line**

Replace the line at `:396`:

```tsx
{isRunning ? <p className="text-sm text-muted-foreground">Assistant is working...</p> : null}
```

with:

```tsx
{isRunning && runningStartedAt != null ? (
  <WorkingIndicator startedAt={runningStartedAt} activeTool={activeTool} />
) : null}
```

- [ ] **Step 5: Type-check and run the existing panel tests**

Run: `cd tracker && npx tsc --noEmit`
Expected: no errors.

Run: `cd tracker && npx vitest run src/components/assistant`
Expected: PASS (existing tests still green; new component test green).

- [ ] **Step 6: Manual smoke check**

Run the tracker dev build, open `/tracker/projects/<slug>/assistant/issue/<id>`, send a message, and confirm the spinner + rotating verb + timer render and that the timer counts up. Toggle OS "reduce motion" and confirm the spinner stops rotating and the verb stays static.

- [ ] **Step 7: Commit**

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx
git commit -m "feat(tracker): show animated working indicator while assistant runs"
```

---

## Self-Review

- **Spec coverage (§5):** spinner ✓ (Task 1 Step 3), rotating verbs ✓, elapsed timer ✓, active tool name ✓ (Task 1 + Task 2 Step 3), reduced-motion ✓ (Task 1 Step 3). No backend ✓.
- **Placeholder scan:** none — verb list is concrete; all steps include code or exact commands.
- **Type consistency:** `WorkingIndicator` props `{ startedAt: number; activeTool?: string | null }` are used identically in Task 1 and Task 2. `STREAMING_ASSISTANT_ID` already exists in `ProjectAssistantPanel.tsx:66`.
