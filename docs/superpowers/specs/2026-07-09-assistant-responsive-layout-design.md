# Assistant responsive layout

**Date:** 2026-07-09  
**Status:** Approved for planning  
**Worktree:** `.worktrees/assistant-responsive-layout` (`feature/assistant-responsive-layout`)  
**Preview:** `http://localhost:5174/tracker/`

## Problem

On narrow viewports the assistant page fights itself:

1. **Tasks dock** sits beside the transcript (`w-72` / `lg:w-80`), squeezing chat and truncating task titles.
2. **Composer toolbar** packs session tools (Tasks, Diff, stats, KB, Yolo/Magic) and three model menus into one dense row that is hard to scan.
3. **Session header bar** mixes pill chips, naked icon buttons, and outline labeled buttons with inconsistent height/radius/weight.

Large screens already work; changes must not regress `lg+` density.

## Goals

1. Below `lg` (`< 1024px`), chat keeps full width when Tasks is open.
2. Below `lg`, the composer primary row is scannable: attach, Tasks, one model control, mic, send.
3. Session header actions share one visual system (chips / icon buttons / labeled outline buttons).
4. Desktop (`lg+`) keeps today’s side dock and expanded composer toolbar.

## Non-goals

- Changing task derivation, progress math, or non-page assistant modes.
- New overflow semantics for Yolo/execution beyond relocating existing controls.
- Redesigning model catalog search or Magic palette internals.
- Mobile-only navigation chrome outside the assistant session surface.

## Approach

**Adaptive shell + progressive disclosure**, using existing Sheet / DropdownMenu patterns and a shared `useMediaQuery` / `useIsLgUp` hook aligned to Tailwind `lg`.

### 1. Tasks dock

| Viewport | Presentation |
| --- | --- |
| `lg+` | Inline `AssistantTasksDock` beside chat (unchanged). |
| below `lg` | Same task list in `AssistantTasksSheet` (right Sheet overlay). |

- Open state + `localStorage` (`symphony.assistantTasksDock.open`) stay shared.
- Crossing the breakpoint switches presentation without clearing open state.
- Composer / header Tasks toggles continue to drive the same boolean.

### 2. Composer toolbar (option C)

| Viewport | Presentation |
| --- | --- |
| `lg+` | Expanded: labeled tools + three agent/model/effort menus (current). |
| below `lg` | Compact: `+` · Tasks · **one model chip** · mic · send. Diff, KB, Yolo, Magic, and the `+N/-M` chip live in a **More** menu. |

- Model chip opens one menu with agent / model / effort sections (same setters as today).
- No change to submit, attach, voice, or slash/mention behavior.

### 3. Session header bar

Unify `IssueWorkingTreeToolbar` + leading controls in `AssistantSessionTabContent`:

- **Status chips** (issue branch, tasks progress, diff stats): muted pill (`rounded-full`, border, compact mono/tabular text).
- **Icon actions** (open issue, diff, terminal, preview): shared `h-7 w-7` ghost icon button.
- **Labeled actions** (Code, Documents): shared compact outline (`h-7`, icon + label from `sm` up; icon-only below `sm`).

No new actions — visual consistency only.

## Architecture

```
ProjectAssistantPanel
  ├─ useIsLgUp()
  ├─ showTasksDock  → AssistantTasksDock   (lg+ && open)
  └─ showTasksSheet → AssistantTasksSheet  (!lg && open)

AssistantComposer
  ├─ toolbarAfterAttach (primary: Tasks)
  ├─ toolbarMore (secondary tools; More menu below lg)
  └─ ComposerToolbar compact|expanded

IssueSessionSplitLayout
  └─ IssueWorkingTreeToolbar (shared action styles)
```

## Error handling / edge cases

- Empty task snapshot: sheet/dock must not render (fail closed; sheet throws if mounted empty).
- `matchMedia` unavailable: treat as not-`lg` (sheet path) so chat is never squeezed by an inline dock.
- More menu with zero secondary tools: omit the More trigger.
- Header without issue binding: existing early returns unchanged.

## Testing

- Unit: `useMediaQuery`, `AssistantTasksSheet`, compact `ComposerToolbar`, header button class consistency via existing layout tests.
- Manual on `:5174`: resize across `lg`, toggle Tasks, open More + model chip, confirm `lg+` unchanged.

## Prototype location

Implementation and live preview live in the forked worktree above so operators can validate against real Symphony UI, not throwaway mockups.
