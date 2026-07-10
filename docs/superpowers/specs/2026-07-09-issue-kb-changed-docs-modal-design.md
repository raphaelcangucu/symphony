# Issue KB modal — changed docs filter + unified Docs/KB triggers

**Date:** 2026-07-09  
**Status:** Approved for planning  
**Context:** Issue assistant / session toolbar on workspaces such as  
`http://localhost:4000/tracker/projects/macro-markets/workspaces/7999`

## Problem

1. **Docs** (session/header toolbar) and **KB** (composer) both open `KnowledgeBaseModal` with the **full project tree** — no issue filter.
2. On 2026-07-04 (`65acd80`), `IssueDocumentsDrawer` stopped opening the issue-scoped sheet (`AssistantKbDocumentsPanel` with “changed docs in this task”) and started opening the generic KB modal instead.
3. Docs and KB use **different icons** (`FileText` vs `BookOpen`).
4. There is **no badge** on either trigger when the issue working tree has modified docs.

Specs written by the agent for a tracked issue (e.g.  
`docs/superpowers/specs/2026-07-09-510-cross-tenant-markets-settlement-design.md`) live in the **issue working tree** (e.g.  
`…/macro-markets-workspaces/clouapp/front/510/…`), not in the Symphony checkout. The UI must surface those paths via the issue workspace diff, not via Symphony’s own `docs/` tree.

## Goals

1. On an issue context, **Docs** and **KB** open the **same** `KnowledgeBaseModal`, defaulting to a tree filtered to **`docs/` files changed in the issue working-tree uncommitted diff across all repos**.
2. Modal exposes a toggle **Alterados | Todos** so the user can expand to the full project KB tree without leaving the modal.
3. Both triggers use the **same icon** (`BookOpen`).
4. Both triggers show a **dot badge** when there is at least one changed `docs/` path.
5. Remove the regressive “open generic KB from Docs” behavior; do not restore the old sheet/`DocumentViewer` entrypoints for this toolbar path.

## Non-goals

- Replacing or deleting `IssueDocuments` backend APIs / `assistant_document_changed` (still used for fingerprint refresh).
- Changing the standalone `/kb` project page or personal KB.
- Filtering by chat citations (`citedPaths`) or by `IssueDocuments.list` referenced paths — **source of truth is git uncommitted diff**.
- Numbered badge counts (dot only).
- New backend “changed docs” endpoint (reuse existing issue/thread diff).

## Decisions (approved)

| Topic | Choice |
| --- | --- |
| Open target | Same `KnowledgeBaseModal` for Docs and KB |
| Default filter (issue) | Changed `docs/` paths from uncommitted working-tree diff, all repos |
| Toggle | Alterados \| Todos |
| Icon | `BookOpen` on both triggers |
| Badge | Dot on **both** Docs and KB when `changedDocsCount > 0` |
| Old sheet / DocumentViewer for this path | Do not restore; remove from Docs entrypoint |
| Approach | Extend `KnowledgeBaseModal` + shared hook over `getGitDiff` |

## Approach

### 1. Shared changed-docs hook

Add something like `useIssueChangedDocPaths({ projectSlug, issueIdentifier, enabled })`:

1. Call existing `getGitDiff(projectSlug, identifier, "uncommitted")` (same multi-repo envelope as Diff / `useWorkspaceDiffStats`).
2. Collect `repos[].files[].path` (and `old_path` when relevant for renames) where the path is under `docs/` (prefix match after normalizing separators).
3. **Normalize for the KB tree:** project KB node paths are **docs-relative** (e.g. `superpowers/specs/….md`), while git paths are usually repo-relative (`docs/superpowers/specs/….md`). Strip a leading `docs/` before matching/`filterTreeByPaths`. Keep the raw git path only for diagnostics if needed.
4. Return `{ paths: string[] /* docs-relative */, count: number, reload }`.

Optional later: also accept `threadId` + `getThreadGitDiff` for freeform threads; **v1 is issue-identifier only** (Docs/KB on issue sessions).

**Issue working-tree vs project KB tree:** today’s `KnowledgeBaseModal` loads the **project** overview/tree (not `getIssueRepoTree`). Changed paths from the issue workspace still match the same docs-relative paths in the project tree when the file exists there; if a brand-new doc exists only in the issue worktree and not yet in the project tree, either insert a synthetic page (same pattern as cited-docs) or fall back to issue-scoped tree load for Alterados mode. Prefer **synthetic page insertion for missing paths** in v1 so we do not switch the whole modal to issue-tree APIs.

Refresh when:

- hook mounts / deps change
- socket event `assistant_document_changed` for this identifier (already pushed from `AssistantChannel`)
- after Diff modal commit success if the parent already reloads workspace stats (piggyback if cheap)

### 2. Extend `KnowledgeBaseModal`

New optional props:

- `issueIdentifier?: string | null`
- `changedDocPaths?: string[]` (or load internally via the hook when `open && issueIdentifier`)

Behavior when `issueIdentifier` is set:

- Default filter mode: **`changed`**
- Sidebar tree = `filterTreeByPaths(treesByRepo, changedPathSet)` (reuse the same tree-pruning idea as `AssistantKbDocumentsPanel`’s cited filter)
- Header shows toggle **Alterados | Todos**
- Subtitle reflects count of changed docs when in Alterados mode
- **Todos** shows the current full project overview/tree (same as today’s modal — project KB, not a second product)

When `issueIdentifier` is absent: unchanged modal (no toggle, full tree).

Docs and KB must pass the same `issueIdentifier` so both open the filtered modal.

### 3. Triggers + badge

| Trigger | Today | After |
| --- | --- | --- |
| Docs (`IssueDocumentsDrawer` / session header) | `FileText` → generic modal | `BookOpen` → modal with issue scope + filter |
| KB (composer in `ProjectAssistantPanel`) | `BookOpen` → generic modal | Same icon → same modal with issue scope when `issueIdentifier` present |

Badge: small absolute-positioned dot on the icon button when `count > 0`. No numeric label. Dot clears when count returns to 0 (not merely “on open”).

Prefer one shared open state (or both triggers calling the same `onOpenChange`) so Docs and KB do not mount two modals.

### 4. Cleanup

- `IssueDocumentsDrawer`: stop opening unscoped `KnowledgeBaseModal`; pass `issueIdentifier` (and share modal with composer if both are on screen).
- Do **not** reintroduce the Sheet + `AssistantKbDocumentsPanel` issue “changed docs” entrypoint for this toolbar.
- Do **not** wire Docs to `DocumentViewer` / `IssueDocuments.list` for this path.
- Keep `AssistantKbDocumentsPanel` where it still powers embedded authoring / assistant routes; only detach it from the Docs toolbar regression. If a follow-up finds it unused, delete in a separate cleanup — not required for this feature.

## Data flow

```text
Issue session (identifier)
  → useIssueChangedDocPaths → getGitDiff(uncommitted)
  → paths under docs/ (all repos)
  → Docs button + KB button (BookOpen + dot if count > 0)
  → KnowledgeBaseModal(open, projectSlug, issueIdentifier, changedDocPaths)
       default filter=changed → pruned tree
       toggle all → full project tree
```

## Testing

1. **Unit:** given a multi-repo diff fixture, only `docs/**` paths are collected; non-docs ignored; empty diff → count 0.
2. **Modal:** with issue + non-empty changed paths, open starts in Alterados and hides unrelated folders; Todos shows full tree; without issue, no toggle.
3. **Triggers:** Docs and KB render `BookOpen`; both show a dot when count > 0 and hide it when 0; both open the scoped modal.
4. **Regression:** project-level KB (no issue) still opens full tree.

## Out of scope follow-ups

- Auto-select the newest changed doc on open.
- Per-node dots inside the tree.
- Filtering committed-but-unpushed docs (v1 = uncommitted only, matching Diff chip).
