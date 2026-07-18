# Preview Floating Surfaces — Implementation Plan

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) steps. Prefer **(A)** a fresh subagent or focused session per task with review between tasks, or **(B)** inline execution in one chat with checkpoints after each task. Replace example commands with this repo’s real tools (package manager, test runner, linter).

**Goal:** Add app-shell floating windows (Fullscreen + Popout) for all terminals and the minibrowser, plus denser Preview sidebar management UX.

**Architecture:** A Zustand vanilla `floatingSurfaceStore` holds open windows; `FloatingSurfaceHost` mounts in `Layout` beside `MaestroHost` so surfaces survive route changes. Shared chrome (Fullscreen / Popout) wires docks and panels into the host. Minibrowser gains an app-owned history toolbar. Preview management UI sheds the heavy Card wrapper.

**Tech Stack:** React 19, Vite, Vitest + Testing Library, Zustand vanilla + `useSyncExternalStore`, Tailwind, lucide-react, sonner toasts, i18next (`tracker/locales`).

**Spec:** [`docs/superpowers/specs/2026-07-18-preview-floating-surfaces-design.md`](../specs/2026-07-18-preview-floating-surfaces-design.md)

**WSL testing:** Run **one** narrowly targeted test file or filter at a time. Never batch files, never repository-wide suites, never parallel test loops. Ask before expanding scope. Same rule for any subagent.

---

## File map

| Path | Role |
|------|------|
| Create `tracker/src/lib/floatingSurfaceIds.ts` | Stable id builders + payload types |
| Create `tracker/src/lib/__tests__/floatingSurfaceIds.test.ts` | Id / payload validation |
| Create `tracker/src/stores/floatingSurfaceStore.ts` | Open/focus/close/bounds/z-index/max-6 |
| Create `tracker/src/stores/__tests__/floatingSurfaceStore.test.ts` | Store behaviors |
| Create `tracker/src/hooks/useFloatingSurfaces.ts` | `useSyncExternalStore` subscription |
| Create `tracker/src/components/floating/FloatingSurfaceWindow.tsx` | Draggable/resizable frame |
| Create `tracker/src/components/floating/FloatingSurfaceHost.tsx` | Renders all open surfaces |
| Create `tracker/src/components/floating/FloatingSurfaceContent.tsx` | Kind → content switch |
| Create `tracker/src/components/floating/__tests__/FloatingSurfaceHost.test.tsx` | Mount + route persistence smoke |
| Create `tracker/src/lib/minibrowserHistory.ts` | App-owned back/forward stack helpers |
| Create `tracker/src/lib/__tests__/minibrowserHistory.test.ts` | Stack push/back/forward |
| Modify `tracker/src/components/layout/Layout.tsx` | Mount `<FloatingSurfaceHost />` |
| Modify `tracker/src/components/issues/issue-detail/DevServerOutputPanel.tsx` | Fullscreen Maximize + Popout |
| Modify `tracker/src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx` | Popout control |
| Modify `tracker/src/components/sessions/IssuePreviewDock.tsx` | Minibrowser toolbar + popout |
| Modify `tracker/src/components/sessions/__tests__/IssuePreviewDock.test.tsx` | Toolbar + popout |
| Modify `tracker/src/components/sessions/IssueTerminalDock.tsx` | Popout control |
| Modify `tracker/src/components/terminal/ProjectTerminalWorkspace.tsx` | Popout control |
| Modify `tracker/src/components/issues/issue-detail/PreviewTab.tsx` | Dense management layout |
| Modify `tracker/locales/en/tracker.json` | New aria/copy keys |
| Modify `tracker/locales/pt-BR/tracker.json` | Matching pt-BR keys |

**Out of scope:** `window.open`, native PiP, `localStorage` bounds persistence, backend preview APIs.

---

### Task 1: Surface ids + store

**Files:**
- Create: `tracker/src/lib/floatingSurfaceIds.ts`
- Create: `tracker/src/lib/__tests__/floatingSurfaceIds.test.ts`
- Create: `tracker/src/stores/floatingSurfaceStore.ts`
- Create: `tracker/src/stores/__tests__/floatingSurfaceStore.test.ts`

- [ ] **Step 1: Write failing id tests**

```ts
import { describe, expect, it } from "vitest";

import {
  buildFloatingSurfaceId,
  type FloatingSurfaceOpenInput,
} from "@/lib/floatingSurfaceIds";

describe("buildFloatingSurfaceId", () => {
  it("builds stable ids per kind", () => {
    expect(
      buildFloatingSurfaceId({
        kind: "dev-server-output",
        projectSlug: "acme",
        issueIdentifier: "ACME-1",
        serverId: 9,
      }),
    ).toBe("dev-server-output:acme:ACME-1:9");

    expect(
      buildFloatingSurfaceId({
        kind: "issue-terminal",
        projectSlug: "acme",
        issueIdentifier: "ACME-1",
      }),
    ).toBe("issue-terminal:acme:ACME-1");

    expect(
      buildFloatingSurfaceId({
        kind: "project-terminal",
        projectSlug: "acme",
        tabId: "shell",
      }),
    ).toBe("project-terminal:acme:shell");

    expect(
      buildFloatingSurfaceId({
        kind: "minibrowser",
        projectSlug: "acme",
        issueIdentifier: "ACME-1",
        serverId: 2,
      }),
    ).toBe("minibrowser:acme:ACME-1:2");
  });

  it("rejects empty projectSlug", () => {
    const input: FloatingSurfaceOpenInput = {
      kind: "project-terminal",
      projectSlug: "  ",
      tabId: "shell",
    };
    expect(() => buildFloatingSurfaceId(input)).toThrow(/projectSlug/i);
  });
});
```

- [ ] **Step 2: Run id test — expect FAIL**

Run: `cd tracker && npm test -- src/lib/__tests__/floatingSurfaceIds.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement ids**

```ts
// tracker/src/lib/floatingSurfaceIds.ts
export type FloatingSurfaceKind =
  | "dev-server-output"
  | "issue-terminal"
  | "project-terminal"
  | "minibrowser";

export type FloatingSurfaceOpenInput =
  | {
      kind: "dev-server-output";
      projectSlug: string;
      issueIdentifier: string;
      serverId: number;
      serverSlug: string;
      title?: string;
    }
  | {
      kind: "issue-terminal";
      projectSlug: string;
      issueIdentifier: string;
      title?: string;
    }
  | {
      kind: "project-terminal";
      projectSlug: string;
      tabId: string;
      title?: string;
    }
  | {
      kind: "minibrowser";
      projectSlug: string;
      issueIdentifier: string;
      serverId: number;
      homeUrl: string;
      title?: string;
    };

function requireNonEmpty(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be a non-empty string`);
  return trimmed;
}

export function buildFloatingSurfaceId(input: FloatingSurfaceOpenInput): string {
  const projectSlug = requireNonEmpty("projectSlug", input.projectSlug);
  switch (input.kind) {
    case "dev-server-output":
      if (!Number.isInteger(input.serverId) || input.serverId <= 0) {
        throw new Error("serverId must be a positive integer");
      }
      return `dev-server-output:${projectSlug}:${requireNonEmpty("issueIdentifier", input.issueIdentifier)}:${input.serverId}`;
    case "issue-terminal":
      return `issue-terminal:${projectSlug}:${requireNonEmpty("issueIdentifier", input.issueIdentifier)}`;
    case "project-terminal":
      return `project-terminal:${projectSlug}:${requireNonEmpty("tabId", input.tabId)}`;
    case "minibrowser":
      if (!Number.isInteger(input.serverId) || input.serverId <= 0) {
        throw new Error("serverId must be a positive integer");
      }
      return `minibrowser:${projectSlug}:${requireNonEmpty("issueIdentifier", input.issueIdentifier)}:${input.serverId}`;
  }
}
```

- [ ] **Step 4: Re-run id tests — expect PASS**

Run: `cd tracker && npm test -- src/lib/__tests__/floatingSurfaceIds.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing store tests**

```ts
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_FLOATING_SURFACES,
  bringFloatingSurfaceToFront,
  closeFloatingSurface,
  listFloatingSurfaces,
  openFloatingSurface,
  resetFloatingSurfaceStoreForTests,
  updateFloatingSurfaceBounds,
} from "@/stores/floatingSurfaceStore";

afterEach(() => {
  resetFloatingSurfaceStoreForTests();
});

describe("floatingSurfaceStore", () => {
  it("opens, dedupes by id, and raises z-index on focus", () => {
    const first = openFloatingSurface({
      kind: "issue-terminal",
      projectSlug: "acme",
      issueIdentifier: "ACME-1",
      title: "Terminal",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = openFloatingSurface({
      kind: "issue-terminal",
      projectSlug: "acme",
      issueIdentifier: "ACME-1",
      title: "Terminal",
    });
    expect(again).toEqual({ ok: true, id: first.id, focusedExisting: true });
    expect(listFloatingSurfaces()).toHaveLength(1);

    const other = openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "shell",
      title: "Project",
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;

    bringFloatingSurfaceToFront(first.id);
    const ordered = listFloatingSurfaces().sort((a, b) => a.zIndex - b.zIndex);
    expect(ordered.at(-1)?.id).toBe(first.id);
  });

  it("rejects a 7th distinct surface", () => {
    for (let i = 1; i <= MAX_FLOATING_SURFACES; i += 1) {
      const result = openFloatingSurface({
        kind: "project-terminal",
        projectSlug: "acme",
        tabId: `tab-${i}`,
        title: `T${i}`,
      });
      expect(result.ok).toBe(true);
    }
    const overflow = openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "tab-overflow",
      title: "Nope",
    });
    expect(overflow).toEqual({ ok: false, reason: "max_surfaces" });
  });

  it("updates bounds and closes", () => {
    const opened = openFloatingSurface({
      kind: "minibrowser",
      projectSlug: "acme",
      issueIdentifier: "ACME-1",
      serverId: 3,
      homeUrl: "http://localhost:5173/",
      title: "Preview",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    updateFloatingSurfaceBounds(opened.id, { x: 40, y: 50, width: 800, height: 500 });
    expect(listFloatingSurfaces()[0]?.bounds).toEqual({ x: 40, y: 50, width: 800, height: 500 });

    closeFloatingSurface(opened.id);
    expect(listFloatingSurfaces()).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run store test — expect FAIL**

Run: `cd tracker && npm test -- src/stores/__tests__/floatingSurfaceStore.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 7: Implement store**

```ts
// tracker/src/stores/floatingSurfaceStore.ts
import { createStore } from "zustand/vanilla";
import { toast } from "sonner";

import {
  buildFloatingSurfaceId,
  type FloatingSurfaceKind,
  type FloatingSurfaceOpenInput,
} from "@/lib/floatingSurfaceIds";

export const MAX_FLOATING_SURFACES = 6;
export const DEFAULT_FLOATING_WIDTH = 720;
export const DEFAULT_FLOATING_HEIGHT = 480;
const CASCADE_OFFSET = 24;

export interface FloatingSurfaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingSurface {
  id: string;
  kind: FloatingSurfaceKind;
  title: string;
  bounds: FloatingSurfaceBounds;
  zIndex: number;
  payload: FloatingSurfaceOpenInput;
}

interface FloatingSurfaceStoreState {
  surfaces: FloatingSurface[];
  nextZIndex: number;
}

const store = createStore<FloatingSurfaceStoreState>(() => ({
  surfaces: [],
  nextZIndex: 1,
}));

export type OpenFloatingSurfaceResult =
  | { ok: true; id: string; focusedExisting?: boolean }
  | { ok: false; reason: "max_surfaces" };

function defaultBounds(openCount: number): FloatingSurfaceBounds {
  const offset = (openCount % 6) * CASCADE_OFFSET;
  return {
    x: 64 + offset,
    y: 64 + offset,
    width: DEFAULT_FLOATING_WIDTH,
    height: DEFAULT_FLOATING_HEIGHT,
  };
}

function clampBounds(bounds: FloatingSurfaceBounds): FloatingSurfaceBounds {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const width = Math.min(Math.max(bounds.width, 320), vw);
  const height = Math.min(Math.max(bounds.height, 240), vh);
  const x = Math.min(Math.max(bounds.x, 0), Math.max(vw - 80, 0));
  const y = Math.min(Math.max(bounds.y, 0), Math.max(vh - 80, 0));
  return { x, y, width, height };
}

export function openFloatingSurface(input: FloatingSurfaceOpenInput): OpenFloatingSurfaceResult {
  const id = buildFloatingSurfaceId(input);
  const state = store.getState();
  const existing = state.surfaces.find((surface) => surface.id === id);
  if (existing) {
    bringFloatingSurfaceToFront(id);
    return { ok: true, id, focusedExisting: true };
  }
  if (state.surfaces.length >= MAX_FLOATING_SURFACES) {
    return { ok: false, reason: "max_surfaces" };
  }

  const zIndex = state.nextZIndex;
  const surface: FloatingSurface = {
    id,
    kind: input.kind,
    title: input.title?.trim() || input.kind,
    bounds: clampBounds(defaultBounds(state.surfaces.length)),
    zIndex,
    payload: input,
  };

  store.setState({
    surfaces: [...state.surfaces, surface],
    nextZIndex: zIndex + 1,
  });
  return { ok: true, id };
}

/** Convenience: open + toast on max. Returns id or null. */
export function openFloatingSurfaceOrToast(
  input: FloatingSurfaceOpenInput,
  maxMessage: string,
): string | null {
  const result = openFloatingSurface(input);
  if (!result.ok) {
    toast.error(maxMessage);
    return null;
  }
  return result.id;
}

export function bringFloatingSurfaceToFront(id: string): void {
  store.setState((state) => {
    const index = state.surfaces.findIndex((surface) => surface.id === id);
    if (index < 0) return state;
    const zIndex = state.nextZIndex;
    const surfaces = state.surfaces.map((surface, i) =>
      i === index ? { ...surface, zIndex } : surface,
    );
    return { surfaces, nextZIndex: zIndex + 1 };
  });
}

export function closeFloatingSurface(id: string): void {
  store.setState((state) => {
    if (!state.surfaces.some((surface) => surface.id === id)) return state;
    return { surfaces: state.surfaces.filter((surface) => surface.id !== id) };
  });
}

export function updateFloatingSurfaceBounds(id: string, bounds: FloatingSurfaceBounds): void {
  const next = clampBounds(bounds);
  store.setState((state) => ({
    surfaces: state.surfaces.map((surface) =>
      surface.id === id ? { ...surface, bounds: next } : surface,
    ),
  }));
}

export function listFloatingSurfaces(): FloatingSurface[] {
  return store.getState().surfaces;
}

export function getFloatingSurfaceStore() {
  return store;
}

export function resetFloatingSurfaceStoreForTests(): void {
  store.setState({ surfaces: [], nextZIndex: 1 });
}
```

- [ ] **Step 8: Run store tests — expect PASS**

Run: `cd tracker && npm test -- src/stores/__tests__/floatingSurfaceStore.test.ts`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add tracker/src/lib/floatingSurfaceIds.ts \
  tracker/src/lib/__tests__/floatingSurfaceIds.test.ts \
  tracker/src/stores/floatingSurfaceStore.ts \
  tracker/src/stores/__tests__/floatingSurfaceStore.test.ts
git commit -m "$(cat <<'EOF'
feat(tracker): add floating surface store and stable ids

Registry for app-shell popout windows with dedupe, z-index, and a hard cap of six.
EOF
)"
```

---

### Task 2: Host window frame + Layout mount

**Files:**
- Create: `tracker/src/hooks/useFloatingSurfaces.ts`
- Create: `tracker/src/components/floating/FloatingSurfaceWindow.tsx`
- Create: `tracker/src/components/floating/FloatingSurfaceContent.tsx`
- Create: `tracker/src/components/floating/FloatingSurfaceHost.tsx`
- Create: `tracker/src/components/floating/__tests__/FloatingSurfaceHost.test.tsx`
- Modify: `tracker/src/components/layout/Layout.tsx`

- [ ] **Step 1: Write failing host smoke test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { FloatingSurfaceHost } from "@/components/floating/FloatingSurfaceHost";
import { initTestI18n } from "@/i18n/testUtils";
import {
  openFloatingSurface,
  resetFloatingSurfaceStoreForTests,
} from "@/stores/floatingSurfaceStore";

afterEach(() => {
  resetFloatingSurfaceStoreForTests();
});

describe("FloatingSurfaceHost", () => {
  it("keeps an open surface mounted across route changes", async () => {
    await initTestI18n();
    openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "shell",
      title: "Project shell",
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/a"]}>
        <FloatingSurfaceHost />
        <Routes>
          <Route path="/a" element={<div>Page A</div>} />
          <Route path="/b" element={<div>Page B</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("floating-surface")).toBeInTheDocument();
    expect(screen.getByText("Project shell")).toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={["/b"]}>
        <FloatingSurfaceHost />
        <Routes>
          <Route path="/a" element={<div>Page A</div>} />
          <Route path="/b" element={<div>Page B</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("floating-surface")).toBeInTheDocument();
    expect(screen.getByText("Project shell")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run host test — expect FAIL**

Run: `cd tracker && npm test -- src/components/floating/__tests__/FloatingSurfaceHost.test.tsx`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement hook + window + content stubs + host**

```ts
// tracker/src/hooks/useFloatingSurfaces.ts
import { useSyncExternalStore } from "react";

import {
  getFloatingSurfaceStore,
  listFloatingSurfaces,
  type FloatingSurface,
} from "@/stores/floatingSurfaceStore";

export function useFloatingSurfaces(): FloatingSurface[] {
  const store = getFloatingSurfaceStore();
  return useSyncExternalStore(
    store.subscribe,
    () => listFloatingSurfaces(),
    () => listFloatingSurfaces(),
  );
}
```

`FloatingSurfaceWindow.tsx` responsibilities:
- `data-testid="floating-surface"`
- Absolute positioned `div` using `surface.bounds` + `zIndex`
- Header with title, bring-to-front on pointer down, drag via pointer capture on header
- Resize handle (bottom-right corner) updating bounds through `updateFloatingSurfaceBounds`
- Close button → `closeFloatingSurface`
- Children in a `min-h-0 flex-1` body
- No backdrop

`FloatingSurfaceContent.tsx` switch:
- `dev-server-output` → `TerminalView` when `serverSlug` present; else a small empty-state with Close
- `issue-terminal` → `TerminalWorkspacePanel` embedded for that issue
- `project-terminal` → `ProjectTerminalWorkspace` (or `TerminalView` project kind if workspace is too heavy — prefer `ProjectTerminalWorkspace`)
- `minibrowser` → `FloatingMinibrowser` (thin wrapper: iframe + same toolbar hooks as dock; can be a shared component created in Task 4 — for this task stub with iframe `src={homeUrl}` and title)
- Unknown/stale → empty state text from i18n key `floatingSurface.unavailable`

`FloatingSurfaceHost.tsx`:
```tsx
export function FloatingSurfaceHost() {
  const surfaces = useFloatingSurfaces();
  if (surfaces.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" data-testid="floating-surface-host">
      {surfaces.map((surface) => (
        <div key={surface.id} className="pointer-events-auto">
          <FloatingSurfaceWindow surface={surface}>
            <FloatingSurfaceContent surface={surface} />
          </FloatingSurfaceWindow>
        </div>
      ))}
    </div>
  );
}
```

Mount in `Layout.tsx` next to `<MaestroHost />`:
```tsx
<FloatingSurfaceHost />
<MaestroHost />
```

Add minimal i18n keys now (en + pt-BR):
- `floatingSurface.close`
- `floatingSurface.unavailable`
- `floatingSurface.maxSurfaces`
- `floatingSurface.popout`
- `floatingSurface.dragHandleAria`

- [ ] **Step 4: Run host test — expect PASS**

Run: `cd tracker && npm test -- src/components/floating/__tests__/FloatingSurfaceHost.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/hooks/useFloatingSurfaces.ts \
  tracker/src/components/floating \
  tracker/src/components/layout/Layout.tsx \
  tracker/locales/en/tracker.json \
  tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(tracker): mount FloatingSurfaceHost in app shell

Draggable popout windows live above routes so terminals and preview survive navigation.
EOF
)"
```

---

### Task 3: Dev server output — Fullscreen + Popout

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/DevServerOutputPanel.tsx`
- Modify: `tracker/src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx`
- Modify: `tracker/locales/en/tracker.json` (`issue.devServer.popoutAria`)
- Modify: `tracker/locales/pt-BR/tracker.json`

- [ ] **Step 1: Extend failing tests**

Keep existing fullscreen test (aria still matches `fullscreenAria`). Add:

```ts
it("opens a floating surface popout for the server output", async () => {
  const openSpy = vi.spyOn(
    await import("@/stores/floatingSurfaceStore"),
    "openFloatingSurfaceOrToast",
  ).mockReturnValue("dev-server-output:macro-markets:510:1");

  vi.mocked(fetchDevServerOutput).mockResolvedValue({ output: "line", session_name: "sym" });

  render(
    <DevServerOutputPanel
      projectSlug="macro-markets"
      issueIdentifier="510"
      serverId={1}
      slug="front"
      status="stopped"
      sessionName="sym"
      defaultOpen
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /open front output in popout/i }));
  expect(openSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "dev-server-output",
      projectSlug: "macro-markets",
      issueIdentifier: "510",
      serverId: 1,
      serverSlug: "front",
    }),
    expect.any(String),
  );
});
```

Also assert the keyboard-only control is gone: no button whose only icon intent is "keyboard" without Maximize — the fullscreen button should use Maximize2 and keep `fullscreenAria`.

- [ ] **Step 2: Run DevServerOutputPanel test — expect FAIL on popout**

Run: `cd tracker && npm test -- src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx`

Expected: FAIL (missing popout button)

- [ ] **Step 3: Implement controls**

In `DevServerOutputPanel` header (order): collapse toggle · rerun · **Fullscreen (Maximize2)** · **Popout (SquareArrowOutUpRight)** · Refresh.

Fullscreen behavior unchanged (`Dialog` + `TerminalView`).

Popout:
```ts
openFloatingSurfaceOrToast(
  {
    kind: "dev-server-output",
    projectSlug,
    issueIdentifier,
    serverId,
    serverSlug: slug,
    title: t("issue.devServer.fullscreenTitle", { slug }),
  },
  t("floatingSurface.maxSurfaces"),
);
```

Ensure `FloatingSurfaceContent` for `dev-server-output` renders:
```tsx
<TerminalView
  kind="dev-server"
  projectSlug={payload.projectSlug}
  issueIdentifier={payload.issueIdentifier}
  serverSlug={payload.serverSlug}
  enabled
  className="h-full"
/>
```

- [ ] **Step 4: Re-run tests — expect PASS**

Run: `cd tracker && npm test -- src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/DevServerOutputPanel.tsx \
  tracker/src/components/issues/issue-detail/__tests__/DevServerOutputPanel.test.tsx \
  tracker/src/components/floating/FloatingSurfaceContent.tsx \
  tracker/locales/en/tracker.json \
  tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(preview): add popout and clear fullscreen on server output

Command output can expand locally or detach into a persistent floating terminal.
EOF
)"
```

---

### Task 4: Issue + project terminal popout

**Files:**
- Modify: `tracker/src/components/sessions/IssueTerminalDock.tsx`
- Modify: `tracker/src/components/sessions/__tests__/IssueTerminalDock.test.tsx` (add if missing popout coverage; create assertions in existing file)
- Modify: `tracker/src/components/terminal/ProjectTerminalWorkspace.tsx`
- Modify: `tracker/src/components/terminal/__tests__/ProjectTerminalWorkspace.test.tsx`

- [ ] **Step 1: Write / extend failing tests**

`IssueTerminalDock`: click Popout → `openFloatingSurfaceOrToast` called with
`{ kind: "issue-terminal", projectSlug, issueIdentifier }`.

`ProjectTerminalWorkspace`: click Popout →
`{ kind: "project-terminal", projectSlug, tabId: "shell" }` (use constant `project-shell` or the canonical project tab id from `createProjectTerminalTab`).

- [ ] **Step 2: Run one file — IssueTerminalDock**

Run: `cd tracker && npm test -- src/components/sessions/__tests__/IssueTerminalDock.test.tsx`

Expected: FAIL until popout wired

- [ ] **Step 3: Wire IssueTerminalDock**

In `trailingActions`, insert Popout **before** fullscreen (spec order: Fullscreen then Popout — put Fullscreen first, then Popout, then Close):

```tsx
<Button ... aria-label={t("floatingSurface.popout")} onClick={() => {
  openFloatingSurfaceOrToast(
    {
      kind: "issue-terminal",
      projectSlug,
      issueIdentifier,
      title: t("workspace.terminal.title", { identifier: issueIdentifier }),
    },
    t("floatingSurface.maxSurfaces"),
  );
}}>
  <SquareArrowOutUpRight className="h-3.5 w-3.5" />
</Button>
```

Confirm `workspace.terminal.title` exists; if not, use a new key `workspace.terminal.popoutTitle`.

- [ ] **Step 4: Re-run IssueTerminalDock tests — PASS**

Run: `cd tracker && npm test -- src/components/sessions/__tests__/IssueTerminalDock.test.tsx`

- [ ] **Step 5: Wire ProjectTerminalWorkspace + test**

Add a small header actions row (or trailing control near tabs) with Popout calling `kind: "project-terminal"` and `tabId` from `createProjectTerminalTab(projectSlug, ...).id`.

Run: `cd tracker && npm test -- src/components/terminal/__tests__/ProjectTerminalWorkspace.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tracker/src/components/sessions/IssueTerminalDock.tsx \
  tracker/src/components/sessions/__tests__/IssueTerminalDock.test.tsx \
  tracker/src/components/terminal/ProjectTerminalWorkspace.tsx \
  tracker/src/components/terminal/__tests__/ProjectTerminalWorkspace.test.tsx \
  tracker/locales/en/tracker.json \
  tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(terminal): pop out issue and project terminals to floating host

Keeps shell sessions usable while navigating elsewhere in the tracker.
EOF
)"
```

---

### Task 5: Minibrowser history helpers + dock toolbar

**Files:**
- Create: `tracker/src/lib/minibrowserHistory.ts`
- Create: `tracker/src/lib/__tests__/minibrowserHistory.test.ts`
- Create: `tracker/src/components/sessions/MinibrowserChrome.tsx` (shared toolbar + iframe shell)
- Modify: `tracker/src/components/sessions/IssuePreviewDock.tsx`
- Modify: `tracker/src/components/sessions/__tests__/IssuePreviewDock.test.tsx`
- Modify: `tracker/src/components/floating/FloatingSurfaceContent.tsx` (use same chrome for minibrowser kind)
- Modify locales

- [ ] **Step 1: Failing history unit tests**

```ts
import { describe, expect, it } from "vitest";

import {
  canGoBack,
  canGoForward,
  createMinibrowserHistory,
  goBack,
  goForward,
  navigateTo,
} from "@/lib/minibrowserHistory";

describe("minibrowserHistory", () => {
  it("tracks back/forward stacks", () => {
    let state = createMinibrowserHistory("http://localhost:4102/");
    state = navigateTo(state, "http://localhost:4102/login");
    state = navigateTo(state, "http://localhost:4102/app");
    expect(state.current).toBe("http://localhost:4102/app");
    expect(canGoBack(state)).toBe(true);

    state = goBack(state);
    expect(state.current).toBe("http://localhost:4102/login");
    expect(canGoForward(state)).toBe(true);

    state = goForward(state);
    expect(state.current).toBe("http://localhost:4102/app");

    state = goBack(state);
    state = navigateTo(state, "http://localhost:4102/other");
    expect(canGoForward(state)).toBe(false);
    expect(state.current).toBe("http://localhost:4102/other");
  });

  it("ignores empty or identical navigations", () => {
    const initial = createMinibrowserHistory("http://localhost:4102/");
    expect(navigateTo(initial, "  ")).toEqual(initial);
    expect(navigateTo(initial, "http://localhost:4102/")).toEqual(initial);
  });
});
```

- [ ] **Step 2: Run history tests — FAIL then implement pure helpers — PASS**

Run: `cd tracker && npm test -- src/lib/__tests__/minibrowserHistory.test.ts`

Implementation sketch:
```ts
export interface MinibrowserHistoryState {
  current: string;
  backStack: string[];
  forwardStack: string[];
}

export function createMinibrowserHistory(homeUrl: string): MinibrowserHistoryState {
  const current = homeUrl.trim();
  if (!current) throw new Error("homeUrl must be non-empty");
  return { current, backStack: [], forwardStack: [] };
}

export function navigateTo(state: MinibrowserHistoryState, nextUrl: string): MinibrowserHistoryState {
  const next = nextUrl.trim();
  if (!next || next === state.current) return state;
  return {
    current: next,
    backStack: [...state.backStack, state.current],
    forwardStack: [],
  };
}
// goBack / goForward / canGoBack / canGoForward similarly
```

- [ ] **Step 3: Failing IssuePreviewDock toolbar tests**

When a ready server URL exists:
- Toolbar has Back / Forward / Reload / Stop / Home / URL / Open external / Popout
- Back disabled initially; after committing a new URL via Enter, Back enables
- Home resets to server preview URL
- Stop enabled only while loading (simulate: click reload → Stop enabled → fire iframe `load` → Stop disabled)
- Popout calls `openFloatingSurfaceOrToast` with `kind: "minibrowser"`

- [ ] **Step 4: Run IssuePreviewDock tests — expect FAIL**

Run: `cd tracker && npm test -- src/components/sessions/__tests__/IssuePreviewDock.test.tsx`

- [ ] **Step 5: Implement `MinibrowserChrome` + wire dock**

Move iframe + controls into `MinibrowserChrome`:
- Props: `homeUrl`, `frameTitle`, `onPopout?`, `showPopout?`, `showFullscreen?` (dock already has dock-level fullscreen — pass popout only in dock header or chrome)
- Internal state: history, `reloadKey`, `loading`, `stopped`
- Stop: set `stopped=true`, clear iframe `src` (`about:blank` or omit src), `loading=false`
- Navigate / Home / Reload: clear `stopped`, set loading true, bump key as needed
- `onLoad` on iframe → `loading=false`
- URL bar uses `resolvePreviewNavigationUrl`

In `IssuePreviewDock`:
- Replace footer URL + bare iframe with `<MinibrowserChrome />` when `!showDetails && previewUrl`
- Add Popout next to dock fullscreen when `previewUrl` (and selected server id known)
- Dock-level Fullscreen remains for the whole dock (spec: surface fullscreen vs dock fullscreen — dock keeps existing Maximize; chrome does not duplicate dock fullscreen)

- [ ] **Step 6: Re-run IssuePreviewDock tests — PASS**

Run: `cd tracker && npm test -- src/components/sessions/__tests__/IssuePreviewDock.test.tsx`

- [ ] **Step 7: Wire floating minibrowser content to `MinibrowserChrome`**

`FloatingSurfaceContent` case `minibrowser` uses payload `homeUrl` + identifiers; no second dock fullscreen button inside popout (window has its own close; optional in-window maximize can stretch bounds to viewport — skip in v1, Close only).

- [ ] **Step 8: Commit**

```bash
git add tracker/src/lib/minibrowserHistory.ts \
  tracker/src/lib/__tests__/minibrowserHistory.test.ts \
  tracker/src/components/sessions/MinibrowserChrome.tsx \
  tracker/src/components/sessions/IssuePreviewDock.tsx \
  tracker/src/components/sessions/__tests__/IssuePreviewDock.test.tsx \
  tracker/src/components/floating/FloatingSurfaceContent.tsx \
  tracker/locales/en/tracker.json \
  tracker/locales/pt-BR/tracker.json
git commit -m "$(cat <<'EOF'
feat(preview): minibrowser chrome with history and floating popout

Back/forward/home/stop/loading live above the iframe and can detach into the shell host.
EOF
)"
```

---

### Task 6: Dense Preview management layout

**Files:**
- Modify: `tracker/src/components/issues/issue-detail/PreviewTab.tsx`
- Modify: `tracker/src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx`

- [ ] **Step 1: Extend / adjust PreviewTab tests**

Assert:
- Status strip still present (`issue.preview.statusStripLabel`)
- Outer Card title chrome is gone (no `CardTitle` / reduce: query that `issue.preview.cardTitle` is **not** rendered as a heading, OR keep title as a subtle section label — **choose: remove Card wrapper**, keep `h2` visually quiet or omit; test that primary CTA and server list remain)
- Single primary ask-assistant when failed (still one `askAssistant` button in primary slot; per-server remains only in ⋯ menu)
- Server rows still expose start/stop/restart

- [ ] **Step 2: Run PreviewTab test — expect FAIL if structure assertions added**

Run: `cd tracker && npm test -- src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx`

- [ ] **Step 3: Restructure JSX**

Replace the wrapping `<Card>` with:
```tsx
<div className="space-y-3 text-sm">
  <PreviewStatusStrip ... />
  <div className="flex flex-wrap items-center gap-2">
    <PrimaryPreviewAction ... />
    <SecondaryPreviewControls ... /> {/* ghost stop/restart */}
  </div>
  {openPrimaryUrl ? <ReadyUrlLine ... /> : null}
  {/* callouts unchanged */}
  <section>
    <h3>...</h3>
    <div className="divide-y rounded-lg border">
      {servers.map(... ServerRow ...)}
    </div>
  </section>
</div>
```

Tighten `ServerRow` padding (`p-2`), keep ⋯ menu for open URL + ask assistant. Do not render a second prominent AskAssistant over the output panel.

- [ ] **Step 4: Re-run PreviewTab tests — PASS**

Run: `cd tracker && npm test -- src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add tracker/src/components/issues/issue-detail/PreviewTab.tsx \
  tracker/src/components/issues/issue-detail/__tests__/PreviewTab.test.tsx
git commit -m "$(cat <<'EOF'
refactor(preview): densify preview management panel layout

Drop the heavy card chrome so status, one primary CTA, and server rows read clearer in the dock.
EOF
)"
```

---

### Task 7: Spec status + manual smoke checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-preview-floating-surfaces-design.md` (Status → Approved / Implemented)

- [x] **Step 1: Update spec status to Approved** after code lands (or `Implemented` when all tasks done)

- [ ] **Step 2: Manual smoke (dev server)**

1. Open issue Preview dock with multiple servers  
2. Popout backend log + minibrowser; navigate to another workspace URL — both windows still live  
3. Open issue terminal popout; type a command; confirm session continues  
4. Open 6 popouts; 7th shows toast  
5. Minibrowser: navigate path, Back, Home, Reload, Stop mid-load  

- [x] **Step 3: Final commit for docs**

```bash
git add docs/superpowers/specs/2026-07-18-preview-floating-surfaces-design.md
git commit -m "$(cat <<'EOF'
docs: mark preview floating surfaces spec approved/implemented
EOF
)"
```

---

## Spec coverage checklist

| Spec section | Task |
|--------------|------|
| §3 Host in Layout | Task 2 |
| §3 Store API + max 6 + dedupe | Task 1 |
| §3 Fullscreen vs Popout | Tasks 3–5 |
| §4 Shared chrome order | Tasks 3–5 |
| §5.1 Dev server output | Task 3 |
| §5.2 Issue + project terminals | Task 4 |
| §6 Minibrowser actions | Task 5 |
| §7 Dense Preview layout | Task 6 |
| §8 Errors / stale payload | Task 2 content empty-state |
| §10 Tests listed | Tasks 1–5 |

## Self-review notes

- No TBD placeholders; toast message key `floatingSurface.maxSurfaces` introduced in Task 2 and reused.
- `openFloatingSurfaceOrToast` is the only UI entry for capped opens.
- Minibrowser history is app-owned (not iframe history) — matches spec.
- WSL: every Run step is a single file.
