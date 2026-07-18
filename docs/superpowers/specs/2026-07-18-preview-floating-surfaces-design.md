# Preview sidebar UX — floating surfaces, terminals & minibrowser

**Date:** 2026-07-18  
**Status:** Ready for review  
**Surfaces:** Tracker Preview dock (`IssuePreviewDock`, `PreviewPanel`,
`DevServerOutputPanel`), issue/project terminals, app shell (`Layout`)  
**Related:** existing dock fullscreen in `ProjectSessionsWorkspace`;
`MaestroHost` host pattern in `Layout`

## 1. Problem

The Preview sidebar is hard to work in: management UI is card-heavy, command
output is cramped, and the minibrowser lacks real browser chrome. Fullscreen
exists only at dock level (or as a local Dialog on command output). There is no
way to keep a terminal or preview browser open as a floating window while
navigating to another URL in Symphony.

## 2. Decisions (locked)

| Topic | Choice |
|-------|--------|
| Persistence model | Floating window **inside** the Symphony app shell (not `window.open`, not OS PiP) |
| Scope | Dev-server command output + issue terminal + project terminal + minibrowser |
| Concurrency | Multiple independent floating windows (stackable / draggable) |
| Minibrowser v1 | Back, forward, reload, Home, URL bar, open external, Stop, loading indicator |
| Architecture | Global `FloatingSurfaceHost` in `Layout` + Zustand registry |

## 3. Architecture

### 3.1 Host

- Mount `FloatingSurfaceHost` in `Layout` next to `MaestroHost` (sibling of
  route `Outlet`), so surfaces outlive route changes.
- Absolute overlay; **no modal backdrop** — UI underneath stays interactive.

### 3.2 Store

`floatingSurfaceStore` (Zustand vanilla, same style as `assistantSessionStore`):

```
FloatingSurface = {
  id: string
  kind: "dev-server-output" | "issue-terminal" | "project-terminal" | "minibrowser"
  title: string
  bounds: { x, y, width, height }
  zIndex: number
  payload: kind-specific identifiers
}
```

API: `openSurface`, `focusSurface`, `closeSurface`, `updateBounds`,
`bringToFront`.

### 3.3 Identity (dedupe)

Opening the same logical surface focuses it instead of duplicating:

| Kind | Stable id key |
|------|----------------|
| `dev-server-output` | `project + issue + serverId` |
| `issue-terminal` | `project + issue` |
| `project-terminal` | `project` (+ tab id if tabs exist) |
| `minibrowser` | `project + issue + serverId` |

### 3.4 Fullscreen vs Popout

- **Fullscreen** — expands within the current dock/panel (existing pattern;
  Escape exits). Does **not** move the surface to the host.
- **Popout** — registers/focuses a floating window on the host. Closing the
  popout does not close the dock; the inline surface remains available.

## 4. Shared chrome

Fixed control order on every surface header (inline and popout):

1. Fullscreen (`Maximize2` / `Minimize2`)
2. Popout (panel/window icon)
3. Surface-specific actions
4. Close — on popout windows always; dock keep its own dock-close

Floating window chrome:

- Drag via header; resize via edges; click brings to front (z-index)
- Default size ~720×480 with cascade offset for subsequent windows
- Bounds clamped to viewport
- Max **6** distinct open surfaces. Opening an existing id always focuses it
  (does not create a new window). Opening a 7th distinct id is rejected with a
  toast; no eviction of existing windows.

## 5. Terminals

### 5.1 Dev server command output (`DevServerOutputPanel`)

- Replace the ambiguous keyboard-only control with explicit **Fullscreen** +
  **Popout**.
- Fullscreen keeps today’s interactive `TerminalView` dialog when a session
  exists; otherwise expanded log.
- Popout mounts the interactive terminal (or streaming log) on the host for that
  `serverId`.

### 5.2 Issue & project terminals

- Same Fullscreen + Popout controls on dock / workspace headers.
- Popout reuses the same terminal panel content bindings; do not spawn a second
  destructive session.

## 6. Minibrowser

Toolbar above the iframe (inline dock and popout):

| Action | Behavior |
|--------|----------|
| Back / Forward | App-owned URL stack of committed navigations (not iframe `history`) |
| Reload | Existing iframe `key` bump |
| Stop | Cancel in-flight load (clear/disable src until idle); disabled when idle |
| Home | Navigate to selected server’s ready preview URL (local or tunnel) |
| URL bar | Moved from footer into toolbar; Enter uses `resolvePreviewNavigationUrl` |
| Open external | Current URL in new tab |
| Loading | Spinner until iframe `load`; enables Stop while loading |

- Popout disabled until a ready preview URL exists.
- Changing server tab uses the dedupe key (`serverId`); history stack is per
  minibrowser surface instance.

## 7. Preview sidebar layout

Management panel (details / no URL) hierarchy:

1. Dock header: server tabs + details toggle + browser actions when URL ready +
   dock fullscreen + dock close + minibrowser popout when URL ready
2. Compact one-line status strip: availability · tunnel · tunnel action (no large
   Card)
3. Single primary CTA: open/start preview, or ask assistant on failure
4. Dense server rows (not full Cards): `slug :port · status`, primary badge,
   play/stop/restart, ⋯ menu; collapsible command output with shared chrome
5. Remove duplicate floating “ask assistant” over the output — primary CTA +
   per-server ⋯ only

Default when URL ready: show iframe; details toggle reveals management.

## 8. Errors & limits

- Invalid/stale payload (server/issue gone) → empty state inside the window +
  Close; host must not crash
- No persistence across full page reload (session-only) in v1
- Drag/resize clamped to viewport

## 9. Out of scope

- OS-level separate windows (`window.open`)
- Native Picture-in-Picture
- Persisting window bounds in `localStorage`
- Changing backend preview/tunnel APIs

## 10. Tests

WSL constraint: one narrowly targeted file/filter at a time, sequential.

- `floatingSurfaceStore` — open / focus / dedupe / close / z-index / max cap
- `DevServerOutputPanel` — Fullscreen + Popout controls
- `IssuePreviewDock` — minibrowser toolbar (back/forward/home/stop/loading) +
  popout entry
- `FloatingSurfaceHost` — surface remains mounted across a route change (smoke)

## 11. File map (expected)

| Area | Likely touch |
|------|----------------|
| Host | `tracker/src/components/layout/Layout.tsx`, new `FloatingSurfaceHost` |
| Store | `tracker/src/stores/floatingSurfaceStore.ts` |
| Shared chrome | new small `FloatingSurfaceChrome` / window frame component |
| Preview | `IssuePreviewDock.tsx`, `PreviewPanel` / `PreviewTab.tsx`, `DevServerOutputPanel.tsx` |
| Terminals | `IssueTerminalDock.tsx`, project terminal workspace header |
| i18n | `tracker` locale keys for new aria labels |
| Tests | colocated `__tests__` next to the above |
