# Evidence agent commits → Workspace Diff modal (Commits tab)

**Date:** 2026-07-16  
**Status:** Approved for planning  
**Surfaces:** Issue Evidence tab (`CommitEvidenceSection`), `GitDiffLauncher`, `GitDiffModal`  
**Related:**  
`2026-07-16-chat-edited-file-workspace-diff-design.md`,  
`docs/superpowers/plans/2026-06-29-in-app-diff-commits-viewer-plan.md`

## Problem

The Evidence tab lists agent commits (“Commits do agente”) with `+/-` stats.
Clicking a row opens `CommitDiffSheet`: a side sheet with a custom plain `<pre>`
patch renderer. The assistant and execution surfaces already use the richer
`GitDiffModal` → `GitDiffViewer` (`@pierre/diffs`) stack, including a **Commits**
tab that loads the same `getCommitEvidence` detail API.

Users see two different commit-diff experiences for the same data. The sheet is
the weaker path and should be retired.

## Goals

1. Clicking **anywhere on an Evidence commit row** opens the **same**
   `GitDiffModal` used in the assistant.
2. The modal opens on the **Commits** tab with that commit (`repo` + `sha`)
   selected and detail loaded via the existing commits-tab flow.
3. Branch / Uncommitted / Commits remain available after open (full modal, not a
   commit-only shell).
4. Remove `CommitDiffSheet` and its sheet-only i18n after the migration.

## Non-goals

- Unifying the Evidence launcher with the assistant’s single
  `ProjectAssistantPanel` modal instance (separate mount is fine).
- Wiring `onSendReview` from Evidence (no agent delivery from this entry).
- Backend / `commit_evidence` API changes.
- Redesigning Branch / Uncommitted tabs or commit pagination.
- Making `+/-` stats a separate click target (whole row remains the control).

## Decisions (approved)

| Topic | Choice |
| --- | --- |
| Viewer | Reuse full `GitDiffModal` + `GitDiffViewer` |
| Initial tab | **Commits**, with the clicked commit selected |
| Click target | Entire commit row (current affordance) |
| Approach | Extend `GitDiffLauncher` with focus-commit props (mirrors `focusPath`) |
| Old sheet | Delete `CommitDiffSheet` and `issue.commits.sheet.*` i18n |
| Review from Evidence | Out of scope (`onSendReview` unset) |

## Approach

### 1. Focus-commit props on launcher + modal

Mirror the chat path-focus pattern from
`2026-07-16-chat-edited-file-workspace-diff-design.md`.

Extend `GitDiffLauncher`:

- `focusCommitRequestId?: number` — increment to open and apply focus
- `focusCommit?: { repo: string; sha: string } | null`

When `focusCommitRequestId` increases with a non-empty `repo` + `sha`: open the
modal (if closed) and pass `initialFocusCommit` into `GitDiffModal`. Invalid /
empty commit → no-op.

Extend `GitDiffModal`:

- `initialFocusCommit?: { repo: string; sha: string } | null`
- `onInitialFocusCommitConsumed?: () => void` — clear after apply so the same
  commit can be re-focused on a later request

On apply (when `open` and commit valid):

1. Set `activeTab` to `"commits"`.
2. Set `selectedCommitKey` to the same key the modal already uses for commit
   rows (`repo` + `sha`).
3. Consume the initial focus via callback.
4. Existing commits-tab effects load `getCommitEvidence` for the selected
   commit and render files through `GitDiffViewer`.

If the commit list is still loading, keep the pending key until
`useIssueCommitEvidence` resolves. If the commit never appears in the list,
fall back to the modal’s existing “first commit” selection without a hard
error (detail fetch may still fail and show the commits-tab empty/error UI).

Keyboard shortcut / Compare button remain unchanged (no focus commit).

### 2. Wire Evidence list

`CommitEvidenceSection`:

- Drop `CommitDiffSheet`, `selectedCommit` / `sheetOpen` sheet state.
- Mount `GitDiffLauncher` with `showTrigger={false}`, `projectSlug`,
  `identifier`.
- On row click: set `focusCommit` to `{ repo, sha }` and bump
  `focusCommitRequestId`.

No new data fetching in the section — list data stays on
`useIssueCommitEvidence`; detail stays inside the modal.

### 3. Remove the old sheet

After wiring works:

- Delete `tracker/src/components/issues/issue-detail/CommitDiffSheet.tsx`
- Remove any dedicated sheet tests
- Remove `issue.commits.sheet.*` from `en` and `pt-BR` tracker locales
- Update Evidence tests that assert sheet open behavior to assert the
  canonical modal / launcher path instead

## Data flow

```text
CommitEvidenceSection (row click)
  → focusCommit + focusCommitRequestId++
  → GitDiffLauncher (showTrigger=false)
  → GitDiffModal (initialFocusCommit)
  → activeTab=commits, selectedCommitKey=repo:sha
  → getCommitEvidence(project, issue, repo, sha)  [existing]
  → GitDiffViewer (@pierre/diffs)
```

Shared with assistant Commits tab: list + detail APIs and `GitDiffViewer`.
Not shared: modal ownership (Evidence mounts its own hidden launcher).

## Error handling

| Case | Behavior |
| --- | --- |
| Empty / invalid `focusCommit` on bump | No-op (do not open) |
| Commit missing from list after load | Fallback to first commit; no toast required |
| `getCommitEvidence` failure | Existing commits-tab loading/error/empty UI |
| Workspace unavailable | Existing Evidence list + modal workspace messaging |

## Testing

Narrow frontend tests only (one file / case at a time under WSL):

1. **`GitDiffLauncher`** — bumping `focusCommitRequestId` with a commit opens
   the modal and supplies `initialFocusCommit`.
2. **`GitDiffModal`** — with `initialFocusCommit`, tab is Commits and the
   matching commit is selected (mock commit evidence hooks/services as today).
3. **`EvidenceTab` / `CommitEvidenceSection`** — row click opens the canonical
   modal path; replace `"opens the diff sheet on click"` assertions; no
   `CommitDiffSheet` in the tree.

## Acceptance criteria

- [ ] Evidence commit row click opens `GitDiffModal`, not `CommitDiffSheet`.
- [ ] Modal lands on Commits with the clicked `repo`/`sha` selected.
- [ ] Diff rendering uses `GitDiffViewer` (same as assistant).
- [ ] Branch / Uncommitted remain reachable after open.
- [ ] `CommitDiffSheet` and `issue.commits.sheet.*` are gone.
- [ ] Targeted tests above pass.

## Out of scope follow-ups

- Deduplicating Evidence vs assistant launcher instances at `IssueDrawer` level.
- Enabling line-review send from Evidence.
- Making header/toolbar `+/-` chips in the assistant clickable (unrelated).
