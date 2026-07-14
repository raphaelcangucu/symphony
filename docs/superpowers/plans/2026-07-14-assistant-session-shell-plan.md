# Assistant Session Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Codex-inspired `AssistantSessionShell` across all Tracker chat hosts — single-feed scroll, borderless chrome, codex-chat typography, split-minimal composer, and an icon-driven floating Environment dock (including `surface=autonomous`).

**Architecture:** Extract layout into `AssistantSessionShell` (one feed scroller + fixed composer slot + optional floating dock). Keep `ProjectAssistantPanel` runtime (streaming, tools, approvals). Restyle bubbles/tools and collapse dense composer controls into the existing `ComposerMoreMenu`. Wire Environment actions to existing diff / issue editor entry points via callbacks.

**Tech Stack:** React 19, Tailwind, vitest + Testing Library (tracker only). No new npm deps. No Elixir changes.

**Spec:** [`docs/superpowers/specs/2026-07-14-assistant-session-shell-design.md`](../specs/2026-07-14-assistant-session-shell-design.md)

**Sandbox reference:** `/tracker/dev/assistant-session-proposals`  
**WSL tests:** Run **one** targeted vitest file (or single `-t` filter) at a time; never full suite / parallel batches.

---

## File Structure

**Create:**

- `tracker/src/components/assistant/chatTypography.ts` — CSS variable class name + token helpers
- `tracker/src/components/assistant/AssistantSessionShell.tsx` — layout shell
- `tracker/src/components/assistant/EnvironmentFloatingDock.tsx` — floating Environment panel
- `tracker/src/components/assistant/__tests__/chatTypography.test.ts`
- `tracker/src/components/assistant/__tests__/AssistantSessionShell.test.tsx`
- `tracker/src/components/assistant/__tests__/EnvironmentFloatingDock.test.tsx`

**Modify:**

- `tracker/src/components/assistant/AssistantChatMessageBubble.tsx` — codex-chat + smaller type
- `tracker/src/components/assistant/ToolActivityTimeline.tsx` (and/or compact tool row) — collapsed by default
- `tracker/src/components/assistant/AssistantComposer.tsx` — split-minimal density; smaller type
- `tracker/src/components/assistant/ComposerToolbar.tsx` — ensure More menu works as primary overflow for secondary tools
- `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — render inside shell; expose env toggle hooks
- `tracker/src/components/sessions/AssistantSessionTabContent.tsx` — remove card/shadow wrapper scroll nesting
- `tracker/src/components/sessions/IssueSessionSplitLayout.tsx` — keep toolbar; no outer overflow card
- `tracker/src/components/assistant/__tests__/AssistantChatMessageBubble.test.tsx` (or create if missing)
- `tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx` — assert overflow menu holds Diff/KB/Yolo
- `tracker/src/components/sessions/__tests__/AssistantSessionTabContent.test.tsx` — assert no nested card scroll class
- `tracker/src/pages/AssistantSessionLayoutProposalsPage.tsx` — already aligned; verify IDs stay locked
- `tracker/locales/en/tracker.json` + `tracker/locales/pt-BR/tracker.json` — Environment dock strings

**Do not modify (runtime):** assistant stream collectors, Elixir history, Phoenix channels — unless a test fixture must be updated for class names.

---

### Task 1: Chat typography tokens

**Files:**

- Create: `tracker/src/components/assistant/chatTypography.ts`
- Test: `tracker/src/components/assistant/__tests__/chatTypography.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ASSISTANT_CHAT_TYPOGRAPHY_CLASS, chatTypographyStyle } from "@/components/assistant/chatTypography";

describe("chatTypography", () => {
  it("exports a stable class name for the shell scope", () => {
    expect(ASSISTANT_CHAT_TYPOGRAPHY_CLASS).toBe("assistant-chat-typography");
  });

  it("defines CSS variables for body, meta, mono, and title sizes", () => {
    const style = chatTypographyStyle();
    expect(style["--chat-body"]).toBe("12.5px");
    expect(style["--chat-meta"]).toBe("10.5px");
    expect(style["--chat-mono"]).toBe("10.5px");
    expect(style["--chat-title"]).toBe("12px");
    expect(style["--chat-body-leading"]).toBe("1.45");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/chatTypography.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CSSProperties } from "react";

export const ASSISTANT_CHAT_TYPOGRAPHY_CLASS = "assistant-chat-typography";

type ChatTypographyVars = CSSProperties & {
  "--chat-body": string;
  "--chat-meta": string;
  "--chat-mono": string;
  "--chat-title": string;
  "--chat-body-leading": string;
};

export function chatTypographyStyle(): ChatTypographyVars {
  return {
    "--chat-body": "12.5px",
    "--chat-meta": "10.5px",
    "--chat-mono": "10.5px",
    "--chat-title": "12px",
    "--chat-body-leading": "1.45",
  };
}
```

Add to `tracker/src/index.css` (or the app’s global CSS entry):

```css
.assistant-chat-typography {
  --chat-body: 12.5px;
  --chat-meta: 10.5px;
  --chat-mono: 10.5px;
  --chat-title: 12px;
  --chat-body-leading: 1.45;
}
```

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/chatTypography.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/chatTypography.ts \
  tracker/src/components/assistant/__tests__/chatTypography.test.ts \
  tracker/src/index.css
git commit -m "$(cat <<'EOF'
feat(tracker): add assistant chat typography tokens

EOF
)"
```

---

### Task 2: `AssistantSessionShell` (single scroll + slots)

**Files:**

- Create: `tracker/src/components/assistant/AssistantSessionShell.tsx`
- Test: `tracker/src/components/assistant/__tests__/AssistantSessionShell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantSessionShell } from "@/components/assistant/AssistantSessionShell";

describe("AssistantSessionShell", () => {
  it("keeps a single feed scroller and pins composer outside it", () => {
    render(
      <AssistantSessionShell
        toolbar={<div>toolbar</div>}
        feed={<div>feed-body</div>}
        dock={<div>approval-dock</div>}
        composer={<div>composer-body</div>}
      />,
    );

    const root = screen.getByTestId("assistant-session-shell");
    expect(root).toHaveClass("assistant-chat-typography");
    expect(root).not.toHaveClass("rounded-xl", "shadow-sm");

    const feed = screen.getByTestId("assistant-session-feed");
    expect(feed.className).toMatch(/overflow-y-auto/);
    expect(feed).toHaveTextContent("feed-body");
    expect(feed).not.toHaveTextContent("composer-body");

    expect(screen.getByTestId("assistant-session-composer")).toHaveTextContent("composer-body");
    expect(screen.getByTestId("assistant-session-composer").className).toMatch(/shrink-0/);
  });

  it("renders optional environment overlay without creating a second page scroller on root", () => {
    render(
      <AssistantSessionShell
        feed={<div>feed</div>}
        composer={<div>composer</div>}
        environment={<div data-testid="env-panel">env</div>}
      />,
    );
    const root = screen.getByTestId("assistant-session-shell");
    expect(root.className).toMatch(/overflow-hidden/);
    expect(root.className).not.toMatch(/overflow-y-auto/);
    expect(screen.getByTestId("env-panel")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/AssistantSessionShell.test.tsx`

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { ReactNode } from "react";
import {
  ASSISTANT_CHAT_TYPOGRAPHY_CLASS,
  chatTypographyStyle,
} from "@/components/assistant/chatTypography";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";

export interface AssistantSessionShellProps {
  toolbar?: ReactNode;
  feed: ReactNode;
  dock?: ReactNode;
  composer: ReactNode;
  environment?: ReactNode;
  className?: string;
  feedRef?: (node: HTMLDivElement | null) => void;
}

export function AssistantSessionShell({
  toolbar = null,
  feed,
  dock = null,
  composer,
  environment = null,
  className,
  feedRef,
}: AssistantSessionShellProps) {
  return (
    <section
      data-testid="assistant-session-shell"
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-background",
        ASSISTANT_CHAT_TYPOGRAPHY_CLASS,
        className,
      )}
      style={chatTypographyStyle()}
    >
      {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      <div
        ref={feedRef}
        data-testid="assistant-session-feed"
        className={cn("min-h-0 flex-1 overflow-y-auto", SCROLLBAR_THIN)}
      >
        {feed}
      </div>
      {dock ? <div className="shrink-0">{dock}</div> : null}
      <div data-testid="assistant-session-composer" className="shrink-0">
        {composer}
      </div>
      {environment}
    </section>
  );
}
```

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/AssistantSessionShell.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/AssistantSessionShell.tsx \
  tracker/src/components/assistant/__tests__/AssistantSessionShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): add AssistantSessionShell with single feed scroll

EOF
)"
```

---

### Task 3: Wire shell into `ProjectAssistantPanel`

**Files:**

- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` (panel layout around ~1770–1870)
- Modify/extend: `tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx` — one focused case

- [ ] **Step 1: Write the failing test**

Add to `ProjectAssistantPanel.test.tsx` (or a new focused file if the suite is heavy — prefer appending one `it` and running with `-t`):

```tsx
it("page mode uses AssistantSessionShell with a single feed scroller", async () => {
  render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
  expect(await screen.findByTestId("assistant-session-shell")).toBeInTheDocument();
  const feed = screen.getByTestId("assistant-session-feed");
  expect(feed.className).toMatch(/overflow-y-auto/);
  // No nested overflow-y-auto ancestors between shell and feed
  const nested = feed.querySelectorAll(".overflow-y-auto");
  expect(nested.length).toBe(0);
});
```

(Adapt mocks already present in the file so render succeeds.)

- [ ] **Step 2: Run the single test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx -t "AssistantSessionShell"`

Expected: FAIL (testid missing)

- [ ] **Step 3: Implement wiring**

In `ProjectAssistantPanel` panel-mode return:

1. Import `AssistantSessionShell`.
2. Replace the manual `relative flex …` + `overflow-y-auto` message column + composer dock with:

```tsx
<AssistantSessionShell
  feedRef={setScrollContainerRef}
  toolbar={/* existing header when !hideHeader */}
  feed={
    <div className={cn(/* existing max-width padding classes */)}>
      {messageItems}
    </div>
  }
  dock={
    <>
      {resumeBanner}
      {queuedChips}
      {questionsNode}
      {approvalNode}
    </>
  }
  composer={composerNode ?? /* loading placeholder */}
  environment={/* null until Task 7–8 */}
/>
```

3. Remove duplicate `overflow-y-auto` wrappers and absolute composer hacks that create a second scroller when shell owns layout. Keep `useAssistantScroll` attached via `feedRef`.
4. Apply typography to markdown/bubbles in later task; shell already sets tokens.

- [ ] **Step 4: Re-run the single test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx -t "AssistantSessionShell"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): render ProjectAssistantPanel inside AssistantSessionShell

EOF
)"
```

---

### Task 4: Remove session card nested scroll (workspaces hosts)

**Files:**

- Modify: `tracker/src/components/sessions/AssistantSessionTabContent.tsx`
- Modify: `tracker/src/components/sessions/IssueSessionSplitLayout.tsx` (only if it adds overflow card)
- Test: `tracker/src/components/sessions/__tests__/AssistantSessionTabContent.test.tsx`

- [ ] **Step 1: Write / extend failing assertion**

```tsx
it("does not wrap the assistant in a bordered scrolling card", () => {
  render(
    <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />,
  );
  const section = screen.getByRole("region", { hidden: true }) // or query the outer section
  // Prefer: the root section around ProjectAssistantPanel mock
  const card = document.querySelector("section.rounded-xl.border.shadow-sm");
  expect(card).toBeNull();
});
```

Adjust to match how the test file mounts (it already mocks `ProjectAssistantPanel`). Assert the outer wrapper from `AssistantSessionTabContent` no longer has `rounded-xl border … shadow-sm` + nested `overflow-hidden` card chrome — replace with:

```tsx
<section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
```

- [ ] **Step 2: Run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/sessions/__tests__/AssistantSessionTabContent.test.tsx -t "bordered scrolling card"`

Expected: FAIL initially if old classes remain, then green after Step 3

- [ ] **Step 3: Implement**

In `AssistantSessionTabContent.tsx`, change the outer `<section className="… rounded-xl border … shadow-sm">` to borderless `flex min-h-0 flex-1 flex-col overflow-hidden bg-background` (no padding card). Keep `IssueSessionSplitLayout` toolbar row.

This covers both `surface=session` and `surface=autonomous` (same tab content host).

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/sessions/__tests__/AssistantSessionTabContent.test.tsx`

Expected: PASS (entire file once — still one file)

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/sessions/AssistantSessionTabContent.tsx \
  tracker/src/components/sessions/__tests__/AssistantSessionTabContent.test.tsx
git commit -m "$(cat <<'EOF'
fix(tracker): drop bordered card chrome around workspace assistant sessions

EOF
)"
```

---

### Task 5: Codex-chat bubble + smaller type + collapsed tools

**Files:**

- Modify: `tracker/src/components/assistant/AssistantChatMessageBubble.tsx`
- Modify: `tracker/src/components/assistant/ToolActivityTimeline.tsx` (default collapsed summary)
- Modify: `tracker/src/components/assistant/AssistantMarkdown.tsx` if it hardcodes `text-sm`
- Test: create or extend `tracker/src/components/assistant/__tests__/AssistantChatMessageBubble.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantChatMessageBubble } from "@/components/assistant/AssistantChatMessageBubble";

const userMsg = {
  id: "u1",
  role: "user",
  content: "hello",
  toolCalls: [],
  metadata: {},
} as const;

const assistantMsg = {
  id: "a1",
  role: "assistant",
  content: "world",
  toolCalls: [],
  metadata: {},
} as const;

describe("AssistantChatMessageBubble codex-chat", () => {
  it("renders user messages as end-aligned soft bubbles without text-sm", () => {
    render(<AssistantChatMessageBubble message={userMsg as never} />);
    const article = screen.getByTestId("assistant-chat-message").querySelector("article");
    expect(article?.className).not.toMatch(/\btext-sm\b/);
    expect(article?.className).toMatch(/rounded/);
  });

  it("renders assistant messages without a heavy card background", () => {
    render(<AssistantChatMessageBubble message={assistantMsg as never} />);
    const article = screen.getByTestId("assistant-chat-message").querySelector("article");
    expect(article?.className).not.toMatch(/border bg-card|bg-muted\/30/);
  });
});
```

Adapt message type to the real `AssistantChatMessage` fixture shape used elsewhere in tests.

- [ ] **Step 2: Run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/AssistantChatMessageBubble.test.tsx`

Expected: FAIL on `text-sm` / card assertions

- [ ] **Step 3: Implement visual restyle**

In `AssistantChatMessageBubble`:

```tsx
<article
  className={cn(
    "max-w-[min(100%,42rem)]",
    isUser
      ? "rounded-2xl bg-violet-500/10 px-3 py-1.5 text-[length:var(--chat-body)] leading-[var(--chat-body-leading)]"
      : "text-[length:var(--chat-body)] leading-[var(--chat-body-leading)] text-foreground/90",
  )}
>
```

Pass meta / tool labels with `text-[length:var(--chat-meta)]` and mono with `text-[length:var(--chat-mono)]`.

For tools: ensure `ToolActivityTimeline` / tool rows default to **collapsed** one-line summary (chevron to expand). Do not show loud full `RODOU` cards expanded by default.

Update `AssistantMarkdown` wrapper class from `text-sm` to `text-[length:var(--chat-body)] leading-[var(--chat-body-leading)]` when inside chat.

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/AssistantChatMessageBubble.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/AssistantChatMessageBubble.tsx \
  tracker/src/components/assistant/ToolActivityTimeline.tsx \
  tracker/src/components/assistant/AssistantMarkdown.tsx \
  tracker/src/components/assistant/__tests__/AssistantChatMessageBubble.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): restyle assistant bubbles to codex-chat density

EOF
)"
```

---

### Task 6: Composer `split-minimal` (overflow `⋯`)

**Files:**

- Modify: `tracker/src/components/assistant/AssistantComposer.tsx`
- Modify: `tracker/src/components/assistant/ComposerToolbar.tsx` (if needed)
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — how `toolbarMore` / Diff / KB / Yolo are passed
- Test: `tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it("keeps secondary tools inside the more menu in split-minimal layout", () => {
  render(
    <AssistantComposer
      projectSlug="macro-markets"
      bundle={mockBundle}
      onSubmit={vi.fn()}
      toolbarMore={
        <>
          <button type="button">Diff</button>
          <button type="button">KB</button>
          <button type="button">Yolo</button>
        </>
      }
    />,
  );

  // Visible row: attach + more trigger; Diff not directly visible until menu open
  expect(screen.getByLabelText(/attach/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();

  // Open ComposerMoreMenu (aria label from i18n — use existing key)
  fireEvent.click(screen.getByRole("button", { name: /more|mais|⋯/i }));
  expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
});
```

Inspect current `ComposerMoreMenu` trigger `aria-label` in `ComposerToolbar.tsx` and use that exact string/`t()` key.

Also assert textarea uses smaller padding / `text-[length:var(--chat-body)]` and `min-h` reduced from `4.5rem` toward ~`2.75rem`.

- [ ] **Step 2: Run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/AssistantComposer.test.tsx -t "split-minimal"`

Expected: FAIL (Diff still visible on large viewports because today `isLgUp ? toolbarMore : ComposerMoreMenu`)

- [ ] **Step 3: Implement**

In `AssistantComposer.tsx` toolbar row:

```tsx
{toolbarAfterAttach}
{toolbarMore ? (
  <ComposerMoreMenu disabled={disabled || composerDisabled}>{toolbarMore}</ComposerMoreMenu>
) : null}
```

Always use `ComposerMoreMenu` for `toolbarMore` (remove `isLgUp` branch that inlines chips). Keep model/effort on the right via `ComposerToolbar` (compact chip is fine).

Reduce textarea classes:

```tsx
className="min-h-[2.75rem] resize-none border-0 bg-transparent px-3 py-2 text-[length:var(--chat-body)] leading-[var(--chat-body-leading)] shadow-none focus-visible:ring-0"
```

Ensure active toggles (Yolo on, etc.) show at most a small badge on the More trigger — reuse existing pressed styles inside the menu.

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/AssistantComposer.test.tsx -t "split-minimal"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/AssistantComposer.tsx \
  tracker/src/components/assistant/ComposerToolbar.tsx \
  tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/assistant/__tests__/AssistantComposer.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): use split-minimal composer with overflow menu

EOF
)"
```

---

### Task 7: `EnvironmentFloatingDock` (icon actions)

**Files:**

- Create: `tracker/src/components/assistant/EnvironmentFloatingDock.tsx`
- Test: `tracker/src/components/assistant/__tests__/EnvironmentFloatingDock.test.tsx`
- Locales: `tracker/locales/en/tracker.json`, `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EnvironmentFloatingDock } from "@/components/assistant/EnvironmentFloatingDock";

describe("EnvironmentFloatingDock", () => {
  it("renders diff stats, branch, and icon actions", () => {
    const onCompare = vi.fn();
    const onCommitPush = vi.fn();
    render(
      <EnvironmentFloatingDock
        open
        onClose={vi.fn()}
        additions={12}
        deletions={3}
        branch="feat/mac-7"
        sourceLabel="macro-markets"
        onCompare={onCompare}
        onCommitPush={onCommitPush}
      />,
    );

    expect(screen.getByTestId("environment-floating-dock")).toBeInTheDocument();
    expect(screen.getByText(/\+12/)).toBeInTheDocument();
    expect(screen.getByText("feat/mac-7")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(onCompare).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommitPush).toHaveBeenCalledTimes(1);
  });

  it("returns null when closed", () => {
    const { container } = render(
      <EnvironmentFloatingDock open={false} onClose={vi.fn()} additions={0} deletions={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/EnvironmentFloatingDock.test.tsx`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```tsx
import { GitBranch, GitCompare, GitCommitHorizontal, HardDrive, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface EnvironmentFloatingDockProps {
  open: boolean;
  onClose: () => void;
  additions: number;
  deletions: number;
  branch?: string | null;
  sourceLabel?: string | null;
  onCompare?: () => void;
  onCommitPush?: () => void;
  className?: string;
}

export function EnvironmentFloatingDock({
  open,
  onClose,
  additions,
  deletions,
  branch = null,
  sourceLabel = null,
  onCompare,
  onCommitPush,
  className,
}: EnvironmentFloatingDockProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <aside
      data-testid="environment-floating-dock"
      className={cn(
        "absolute bottom-24 right-3 top-12 z-20 flex w-[220px] flex-col gap-3 overflow-y-auto rounded-xl border border-border/70 bg-background/95 p-3 shadow-md backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[length:var(--chat-title)] font-semibold">
          {t("assistant.environment.title")}
        </p>
        <button type="button" aria-label={t("assistant.environment.close")} onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Changes + Local + branch rows */}
      {/* Icon buttons: Commit/push (GitCommitHorizontal), Compare (GitCompare) */}
      {/* Sources row with HardDrive / repo icon */}
    </aside>
  );
}
```

Fill JSX fully (no placeholders). Add i18n keys under `assistant.environment.*` in both locale files.

Action buttons: icon + short label; `title` + `aria-label` required.

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/EnvironmentFloatingDock.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/EnvironmentFloatingDock.tsx \
  tracker/src/components/assistant/__tests__/EnvironmentFloatingDock.test.tsx \
  tracker/locales/en/tracker.json \
  tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(tracker): add Environment floating dock with icon actions

EOF
)"
```

---

### Task 8: Wire Environment dock into session hosts

**Files:**

- Modify: `tracker/src/components/sessions/AssistantSessionTabContent.tsx`
- Modify: `tracker/src/components/assistant/ProjectAssistantPanel.tsx` — accept `environment` slot or own the dock when `issueIdentifier` present
- Prefer owning dock inside `ProjectAssistantPanel` when `issueIdentifier` + workspace diff stats exist, with toolbar toggle

- [ ] **Step 1: Failing test in panel or tab content**

```tsx
it("shows environment dock toggle for issue-bound threads and opens the dock", async () => {
  render(
    <ProjectAssistantPanel
      projectSlug="macro-markets"
      threadId={7996}
      issueIdentifier="MAC-7"
      view="board"
      mode="page"
      hideHeader
    />,
  );
  const toggle = await screen.findByRole("button", { name: /environment/i });
  fireEvent.click(toggle);
  expect(screen.getByTestId("environment-floating-dock")).toBeInTheDocument();
});
```

Use existing panel mocks (diff stats hook mock returning `{ additions: 12, deletions: 3 }`).

- [ ] **Step 2: Run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx -t "environment dock"`

Expected: FAIL

- [ ] **Step 3: Implement wiring**

1. State `environmentOpen` (default `true` when `issueIdentifier` present, else `false`).
2. Toolbar button (HardDrive or PanelRight icon) toggles dock; pass into shell `environment` prop.
3. `onCompare` → bump existing `diffRequestId` / open `GitDiffLauncher` path already used by the panel.
4. `onCommitPush` → open `IssueEditorMenu` programmatically **or** call the same navigation/action the editor menu uses for commit/PR. If no programmatic API exists, render a hidden `IssueEditorMenu` trigger ref and `.click()`, or navigate to the issue git tab — pick the smallest existing path and document it in the PR.
5. Pass `branch` from thread metadata / workspace context if already available; otherwise omit branch row.
6. Freeform `/assistant` without issue: do not render toggle/dock.

Covers `surface=session` and `surface=autonomous` via shared `AssistantSessionTabContent` → `ProjectAssistantPanel`.

- [ ] **Step 4: Re-run test**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx -t "environment dock"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/assistant/ProjectAssistantPanel.tsx \
  tracker/src/components/sessions/AssistantSessionTabContent.tsx \
  tracker/src/components/assistant/__tests__/ProjectAssistantPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(tracker): wire Environment dock into issue-bound assistant sessions

EOF
)"
```

---

### Task 9: Host smoke + sandbox lock + asset build

**Files:**

- Modify tests only if route-level smoke needed: `tracker/src/components/workspace/__tests__/ProjectAssistantRoute.test.tsx` (ensure panel still mounts)
- Verify: `tracker/src/pages/AssistantSessionLayoutProposalsPage.tsx` defaults remain the five final IDs
- Build: `elixir/Makefile` `tracker-build`

- [ ] **Step 1: Run one smoke test file for project assistant route**

Run: `cd /home/raphaelcangucu/symphony/tracker && npx vitest run src/components/workspace/__tests__/ProjectAssistantRoute.test.tsx`

Expected: PASS (update mocks only if shell testids break assertions)

- [ ] **Step 2: Confirm sandbox IDs**

Open defaults in `AssistantSessionLayoutProposalsPage.tsx` — must be:

`codex-chat` + `single-feed` + `borderless` + `split-minimal` + `floating-dock`

- [ ] **Step 3: Rebuild static tracker assets**

Run: `cd /home/raphaelcangucu/symphony/elixir && make tracker-build`

Expected: exit 0

- [ ] **Step 4: Manual checklist (human)**

- `/projects/macro-markets/workspaces?exec=…` (session): one scrollbar, smaller type, composer `⋯`, env dock icons  
- `/projects/macro-markets/workspaces?exec=…&surface=autonomous`: same shell  
- `/projects/macro-markets/assistant`: shell without env (or Sources-only)  
- Hard-refresh after build (asset hash changes)

- [ ] **Step 5: Commit build + any test fixes**

```bash
git add tracker/ elixir/priv/static/tracker
git commit -m "$(cat <<'EOF'
chore(tracker): rebuild assets after assistant session shell

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Single feed scroll | 2, 3, 4 |
| Borderless chrome | 2, 4 |
| Codex-chat feed | 5 |
| Typography tokens / smaller fonts | 1, 5, 6 |
| Composer split-minimal | 6 |
| Floating Environment dock + icon actions | 7, 8 |
| All chat hosts including autonomous | 3, 4, 8, 9 |
| Preserve scroll-follow semantics | 3 (`feedRef` → existing hook) |
| Sandbox reference | 9 |

**Placeholder scan:** none intentional; Task 8 commit/push wiring must use a concrete existing entry point (IssueEditorMenu / GitDiffLauncher) — implementer documents which in the commit message.

**Type consistency:** `AssistantSessionShellProps.environment`, `EnvironmentFloatingDockProps.onCompare` / `onCommitPush` used the same way in Tasks 7–8.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-assistant-session-shell-plan.md`.

Documents:

- Spec: `docs/superpowers/specs/2026-07-14-assistant-session-shell-design.md`
- Plan: `docs/superpowers/plans/2026-07-14-assistant-session-shell-plan.md`
- Sandbox: `/tracker/dev/assistant-session-proposals`
