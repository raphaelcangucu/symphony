# Chat edited-file chips → Workspace Diff modal (with annotations)

**Date:** 2026-07-16  
**Status:** Approved for planning  
**Surfaces:** Assistant chat timeline (`EditedFilesSummary`), `GitDiffLauncher`, `GitDiffModal`, `ProjectAssistantPanel`  
**Related:**  
`2026-07-10-workspace-diff-annotations-layout-design.md`,  
`docs/superpowers/plans/2026-06-29-in-app-diff-commits-viewer-plan.md`,  
`docs/superpowers/plans/2026-07-10-assistant-scroll-compact-timeline-plan.md`

## Problem

Clicking an “Edited N files” chip in the assistant chat opens a thin **Edited file
diff** dialog. That dialog already mounts `GitDiffViewer` (`@pierre/diffs`), but:

1. It often falls back to a plain `<pre>` dump when the tool-call patch is incomplete
   or not a full `diff --git` parse.
2. It does **not** wire line annotations / review comments.
3. It is a second, weaker UX next to **Diff do workspace**, which already has
   side-by-side/unified view, file tree, tabs, and **Enviar review** → agent.

Users expect the chat chip to open the same workspace diff experience, including
annotations that can be sent to the agent.

## Goals

1. Clicking a file chip in chat opens the **full Workspace Diff modal**
   (`GitDiffModal`), not the thin edited-file dialog.
2. The modal opens focused on the clicked path: try **Não commitado** first; if
   the file is not there, fall back to **Branch**.
3. Line annotations and **Enviar review** work exactly as in the existing
   workspace modal (accumulate in memory → one prompt via `onSendReview`).
4. Reuse the single modal instance already owned by `ProjectAssistantPanel` /
   `GitDiffLauncher` (no second `GitDiffModal` mounted from the chat bubble).

## Non-goals

- Changing how `buildDiffReviewPrompt` formats reviews, or persisting comments
  on the server.
- Auto-sending annotations without an explicit **Enviar review**.
- Replacing or redesigning Branch / Uncommitted / Commits tabs.
- Removing the per-chip **+** context-chip action (insert into composer).
- Opening Commits tab from chat chips (out of scope for focus resolution).
- Backend / workspace_diff API changes (frontend focus + wiring only).

## Decisions (approved)

| Topic | Choice |
| --- | --- |
| Delivery to agent | Same as workspace: accumulate → **Enviar review** → one `infer` / resume prompt |
| Modal shape | Reuse full `GitDiffModal` (not the thin dialog) |
| Initial tab | Uncommitted first; if path missing, Branch |
| Ownership | Callback up to panel / launcher (single modal instance) |
| Thin dialog | Remove from `EditedFilesSummary` |
| Context **+** on chip | Keep as today |

## Approach

### 1. Open via existing launcher (single instance)

`EditedFilesSummary` stops owning a `Dialog` + `GitDiffViewer`. On chip click it
calls:

```ts
onOpenWorkspaceDiff?.({ path: file.path })
```

`AssistantChatMessageBubble` / `ProjectAssistantPanel` already host
`GitDiffLauncher` with `onSendReview={sendDiffReview}`. The panel increments a
focus request (same pattern as `openRequestId` / `openCommitDialogRequestId`) and
passes the path into the launcher.

### 2. Launcher + modal focus props

Extend `GitDiffLauncher`:

- `focusPathRequestId?: number` — increment to open and apply focus
- `focusPath?: string | null` — path from the chat chip

Extend `GitDiffModal`:

- `initialFocusPath?: string | null`
- `onInitialFocusConsumed?: () => void` — clear after apply so the same path can
  be re-focused on a later request

When `focusPathRequestId` increases: open modal (if closed) and set
`initialFocusPath`. Keyboard shortcut / Compare button remain unchanged (no
focus path).

### 3. Path resolution inside the modal

On open (or when `initialFocusPath` is set while open):

1. Normalize the requested path (trim; accept tool paths, optional `repo:` /
   display prefixes).
2. Load / wait for **uncommitted** file list; find a match:
   - exact `originalPath` or display path
   - else unique suffix / basename match
3. If found → set tab to `uncommitted`, select that file, consume focus.
4. If not found → repeat against **branch**.
5. If multiple ambiguous matches → prefer the longest / most specific path; if
   still tied, select the first and show a discreet toast that multiple
   occurrences exist.
6. If none in either tab → toast that the file was not found in the workspace
   diff; leave modal on **uncommitted** with no forced selection; consume focus.

Matching should reuse or extract the resolution helper already used by
`EditedFilesSummary` (`resolveEditedFileLocation`) where practical, rather than
forking a third matcher.

### 4. Annotations unchanged

Once the modal is open with `onSendReview` set:

- Click line number → draft → save → in-memory `DiffReviewComment`
- **Enviar review** → `buildDiffReviewPrompt` → `onSendReview(prompt)` →
  existing `sendDiffReview` in `ProjectAssistantPanel`
- Clear comments/notes on successful send or modal close (current behavior)

No new review model. Chat chips do not invent a parallel annotation pipeline.

### 5. Session already open

If the modal is already open and the user clicks another chip:

- Re-run focus resolution (may switch tab / selected file)
- **Keep** in-memory review comments (do not reset the review session)

### 6. Remove thin dialog

Delete the Radix dialog, local patch-fetch-on-open path used only for that
dialog, and related loading UI from `EditedFilesSummary`. Chips still show
`+/-` from tool-call native patches / aggregate diff when available (display
only). The **+** button still builds a composer context chip from tool patch
data when present.

## Data flow

```text
Chat chip click
  → EditedFilesSummary.onOpenWorkspaceDiff({ path })
  → ProjectAssistantPanel increments focusPathRequestId + sets focusPath
  → GitDiffLauncher opens GitDiffModal
  → GitDiffModal resolves path (uncommitted → branch)
  → GitDiffViewer (+ comments / onSaveComment when onSendReview set)
  → Enviar review → sendDiffReview → assistant infer message
```

## Files (expected)

| Area | Files |
| --- | --- |
| Chat chips | `tracker/src/components/assistant/EditedFilesSummary.tsx` (+ tests) |
| Bubble / panel wiring | `AssistantChatMessageBubble.tsx`, `ProjectAssistantPanel.tsx` |
| Launcher | `GitDiffLauncher.tsx` (+ tests) |
| Modal focus | `GitDiffModal.tsx` (+ tests) |
| Optional extract | shared path-match helper (from summary resolver) under `tracker/src/lib/` or git-diff folder |

## Error handling / empty states

| Case | Behavior |
| --- | --- |
| Missing project/issue/thread identity | Do not open; same unavailable rules as launcher |
| Path not in uncommitted or branch | Toast + modal open on uncommitted, no selection |
| Ambiguous matches | Prefer most specific; toast if still ambiguous |
| Patch load failure for selected file | Existing modal error/empty viewer behavior |
| No `onSendReview` in a surface | Review UI stays off (unchanged); chat panel always passes it today |

## Testing

Targeted frontend tests only (no full suite):

1. `EditedFilesSummary`: chip click invokes `onOpenWorkspaceDiff` with path; no
   “Edited file diff” dialog.
2. `GitDiffLauncher`: `focusPathRequestId` opens modal and forwards
   `initialFocusPath`.
3. `GitDiffModal`: focus hits uncommitted; falls back to branch; not-found toast;
   re-focus while open does not clear existing review comments.
4. Existing send-review test remains green (smoke that wiring still works).

## Success criteria

- From chat, opening an edited file uses **Diff do workspace** UI (tabs, tree,
  split/unified, annotation hint).
- User can annotate lines and **Enviar review** to the current assistant session.
- Focus prefers uncommitted, then branch.
- Thin “Edited file diff” dialog is gone.
- Context **+** on chips still works.
