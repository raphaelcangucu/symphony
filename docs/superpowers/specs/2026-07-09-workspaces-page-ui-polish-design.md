# Workspaces page UI polish

**Date:** 2026-07-09  
**Status:** Approved for planning  
**Surface:** `/tracker/projects/:projectSlug/workspaces`  
**Approach:** Local polish (cards + page toolbar); no new design-system primitives

## Problem

The Workspaces inventory page is functional but reads as an internal 2020s admin tool:

1. **Button hierarchy is inconsistent** — header primary, in-page outlines, micro `h-6 text-[11px]` Abrir, ghost card actions, and a hand-styled issue `Link`.
2. **Scan cost is high** — issue ID, title, and status compete across multiple lines; repo metadata stacks vertically; Abrir buttons do not share a stable right gutter.
3. **Visual language drifts from the rest of tracker** — cards use `rounded-lg` while assistant/docks/board prefer `rounded-xl` + light hover lift; status dots are duplicated locally instead of `statusPresentation`; empty states are inline dashed boxes instead of shared `EmptyState`.

## Goals

1. Make each workspace card **scannable in one header line** (status · ID · title · badges) while keeping Execution/Authoring as aligned sub-rows.
2. **Standardize actions** on existing `Button` variants only (`default` / `outline` / `ghost` + `sm` / `icon`).
3. Surface **dev-relevant metadata**: repo health chips (branch, clean/dirty, ahead), disk size, inventory reclaimable chip, relative session freshness.
4. Bring the page visual weight to 2026 **without redesigning project chrome** or inventing a new component library.

## Non-goals

- Redesign of project header, nav tabs, or global chrome (`ProjectWorkspaceLayout` beyond ensuring correct existing variants).
- Extracting shared primitives for board/list reuse (over-abstraction for a page polish).
- Inventory API / data-model changes.
- New themes or dark-mode-only styling.
- Changing card grouping logic in `workspaceCards.ts` (project / active / waiting / orphan / chat).

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Priority | Scan speed + polish |
| Card structure | Hybrid: one-line header + Execution/Authoring sub-rows |
| Info package | Status/ID/title + repo health + session freshness + aligned action gutter |
| Implementation | Local polish of `WorkspaceCardItem` + list toolbar |

## Design

### 1. Card anatomy (`WorkspaceCardItem`)

```
┌─ rounded-xl card ──────────────────────────────────────────┐
│ [dot] GAM-4  Title…  [Status] [Agent]     │ + sessão       │
│                                           │ Issue ↗        │
│ [repo chips…] [disk]                      │ (Remover?)     │
│ ┌ Execution ┬ turns · há 2h ┬ Abrir ┬ ▶? ┐│                │
│ └ Authoring ┴ há 27d       ┴ Abrir ┴    ┘│                │
└────────────────────────────────────────────────────────────┘
```

**Header row**

- One wrapping flex/grid line: execution status dot · mono issue ID · truncated title · `SessionStatusBadge` · `SessionAgentBadge` · kind badges (standalone / parallel / orphan).
- Title moves onto the same line as the ID (no second title block for issue cards).

**Repo health**

- Replace stacked `RepoLine` blocks with compact chips in one wrapping row.
- Chip content: optional repo name · mono branch · clean/dirty (dirty uses amber) · ahead count when `> 0`.
- Disk size chip always last (`HardDrive` + `formatBytes`).
- Keep orphan `workPresent` warning when applicable.

**Action gutter (fixed ~120px)**

- `+ sessão` → `Button variant="default" size="sm"` when `onNewSession` applies.
- Issue open → `Button asChild` + `Link` with `variant="ghost" size="icon"` (ExternalLink) — no raw `<a>`/`Link` class soup.
- Remover → `Button variant="ghost" size="sm"` with destructive hover when removable and not issue/project kinds.

**Session sub-rows**

- Grid columns: fixed label (~96px) | meta (1fr) | actions (auto).
- Meta: for execution `turns · relativeTime`; for authoring/chat `relativeTime`.
- Absolute timestamp remains on `title` / tooltip via existing `formatDateTime`.
- Abrir → `Button variant="outline" size="sm"` (use `h-7`, no ad-hoc `text-[11px]`).
- Resume stays via `ResumeSessionButton` in the actions cluster when resumable.

**Shell**

- `rounded-xl border-border/60 bg-card … shadow-sm`
- Hover: light border emphasis + `-translate-y-px` / `shadow-md` consistent with `IssueCard` (not a heavy card stack).

**Status presentation**

- Delete local `STATUS_DOT_CLASS` / `ExecutionStatusDot` duplication; reuse `executionStatusDotClass` from `statusPresentation.ts` (same path as `SessionListItem`).

### 2. Page toolbar (`ProjectSessionsWorkspace` list tab)

- Replace plain inventory text + loose buttons with a compact bar:
  - Label or muted chip group: tree count · total size · **reclaimable** chip in success tone when `reclaimableBytes > 0`.
  - Actions: Novo workspace + Limpar… as `Button variant="outline" size="sm"` (unchanged variants, clearer grouping).
- Section headings: **sentence case** (drop CSS `uppercase` that forces “AGUARDANDO”).
- Loading / empty: shared `EmptyState variant="simple"` instead of custom dashed boxes.

### 3. Relative time helper

Add `formatRelativeTime(value, nowMs?)` to [`tracker/src/lib/timeFormat.ts`](tracker/src/lib/timeFormat.ts):

- Buckets: seconds / minutes / hours / days (compact, locale-aware via i18n keys, e.g. pt-BR `há 2h`, en `2h ago`).
- Invalid/null → `"-"` (same contract as `formatDateTime`).
- Unit tests alongside existing timeFormat coverage (or new small test file if none).

### 4. i18n

- Add relative-time keys under a shared namespace (prefer `time.relative.*` or `workspacesPage.relative.*`) in `tracker/locales/en/tracker.json` and `pt-BR/tracker.json`.
- No copy rewrite of section titles beyond casing presentation.

## Architecture

```
ProjectSessionsPage
  └─ ProjectSessionsPanel
       └─ ProjectSessionsWorkspace
            ├─ inventory toolbar (chips + outline actions)
            ├─ WorkspaceCardSection (sentence-case title)
            │    └─ WorkspaceCardItem (hybrid anatomy)
            └─ EmptyState (loading / empty)
```

No changes to `buildWorkspaceCards`, hooks, or dialogs beyond consuming the same props.

## Testing

- Keep green: `ProjectSessionsPanel.test.tsx`, `ProjectSessionsWorkspace.test.tsx`, `workspaceCards.test.ts`.
- Add focused assertions where markup roles/text change (e.g. relative meta still exposes open labels; issue link still reachable).
- Unit-test `formatRelativeTime` thresholds.
- Manual: `/tracker/projects/gamba/workspaces` — scan alignment of Abrir, dirty chip, reclaimable chip, header/gutter buttons.

## Acceptance criteria

1. Issue cards show ID + title + status on the first scan line; Execution/Authoring Abrir share a vertical action column.
2. All interactive controls on the list use shared `Button` variants/sizes — no `h-6 text-[11px]` Abrir and no hand-styled issue link.
3. Repo dirty state is amber; disk size is always visible when inventory exists; reclaimable appears as a success chip when non-zero.
4. Sub-row times are relative with absolute `title`; invalid times degrade to `-`.
5. Cards use `rounded-xl` + light hover lift; section titles are sentence case; empty/loading use `EmptyState`.
6. Existing panel/workspace tests pass.

## Out of scope reminders

Header chrome polish beyond variant consistency, new primitives packages, data/API work, and theme redesign remain follow-ups.
