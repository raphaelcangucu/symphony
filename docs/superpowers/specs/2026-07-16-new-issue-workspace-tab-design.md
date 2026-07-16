# New issue as workspace tab — centered chat + composer KB

**Date:** 2026-07-16  
**Status:** Approved for planning  
**Context:** Project assistant “new issue” today lives at  
`/tracker/projects/:slug/assistant/new-issue` with a two-column layout (chat +
docked “Criar issue” / KB aside). Workspaces already use a centered reading
column and open KB from the composer via `KnowledgeBaseModal`.

## Problem

1. The dedicated new-issue page uses a **right sidebar** (`IssueAuthoringPanel`
   page grid + `AssistantKbDocumentsPanel`), which crowds the chat and feels
   distorted next to workspace sessions.
2. Workspaces already have the preferred pattern: **centered chat**
   (`CHAT_READING_COLUMN_CLASS`) and **KB in the composer** (modal, including
   changed-docs consultation).
3. Hosting authoring outside `/workspaces/` makes “create issue with assistant”
   feel like a different product surface than other sessions.

## Goals

1. Open **Nova issue (com assistente)** as an **ephemeral workspace tab** under
   `/projects/:slug/workspaces` (deep link e.g. `?new=1`).
2. **No right authoring aside** on that flow: no “Criar issue” intro card, no
   docked `AssistantKbDocumentsPanel`.
3. Match workspace chat layout: **single centered column**.
4. **KB only via composer** → existing `KnowledgeBaseModal` (same triggers /
   changed-docs behavior as workspace sessions once an issue exists; before
   create, project KB modal without issue filter is fine).
5. When the assistant creates an issue, **morph** the ephemeral tab into the
   existing `authoring-session` tab for that identifier and update the URL to
   `?exec=<identifier>` (session surface).
6. Legacy `/assistant/new-issue` and `/assistant/issue/:id` **redirect** into
   workspaces.

## Non-goals

- Removing or redesigning the global `ProjectSidebar`.
- Changing board/list legacy `new-issue` modal routes (`NewIssueRoute` /
  quick-create dialog).
- Redesigning project explore assistant (`/assistant`) docked KB column.
- Creating a draft issue on tab open (tab stays ephemeral until create).
- Restoring `AssistantKbDocumentsPanel` as a permanent dock for new-issue.
- Full tracker test suite runs (WSL: one targeted test file/filter at a time).

## Decisions (approved)

| Topic | Choice |
| --- | --- |
| Hosting | New workspace tab kind `new-issue` inside `ProjectSessionsWorkspace` |
| Intro “Criar issue” card | Remove |
| Layout | Centered single column (workspace reading column) |
| KB access | Composer → `KnowledgeBaseModal` (not docked panel) |
| Pre-create tab | Ephemeral; no issue identifier until create |
| On create | Replace ephemeral tab with `authoring-session` for new identifier |
| Approach | Dedicated tab kind (not sentinel `authoring-session` id) |
| Legacy routes | Redirect to workspaces (`?new=1` or `?exec=:id`) |
| Entry helpers | `newIssueAssistantPath` → workspace new-issue path |

## Approach

### 1. Layout and hosting

Render new-issue inside `ProjectSessionsWorkspace` as a closable tab.

- Outer shell stays the workspace page (`ProjectHeader` + sessions workspace).
- Tab content is a centered authoring chat only — reuse `IssueAuthoringPanel`
  with `compact={true}` (already omits the aside), or a thin wrapper around
  `ProjectAssistantPanel` with the same embedded/page reading-column behavior
  workspaces use.
- Do not mount `AssistantKbDocumentsPanel` or the issue-context / “Criar issue”
  cards on this tab.
- Global left nav unchanged.

### 2. Tab model and URL

Add workspace tab kind `new-issue`:

- Factory e.g. `createNewIssueTab(title)` with a **stable id** per project
  (only one ephemeral new-issue tab).
- Deep link: `projectNewIssueWorkspacePath(slug)` →  
  `/projects/:slug/workspaces?new=1` (exact query key fixed in implementation;
  must not collide with `exec` / `surface` / thread routes).
- Opening “Nova issue” while the tab already exists **focuses** it; does not
  open a second ephemeral tab.
- If URL has both `new=1` and `exec=<id>`, **`exec` wins** (open authoring for
  that issue).

### 3. Lifecycle

```text
Entry (menu / redirect)
  → open or focus new-issue tab
  → URL ?new=1
  → ProjectAssistantPanel authoring without issueIdentifier

onIssueCreated({ identifier })
  → close/replace new-issue tab
  → open createAuthoringSessionTab(identifier, title)
  → navigate projectAuthoringSessionPath(slug, identifier)
  → clear ?new=1

Close tab before create
  → discard UI only; no orphan draft issue
```

Refresh on `?new=1` reopens the ephemeral tab; thread/session behavior follows
existing project-authoring panel semantics (no new backend contract required
for v1).

### 4. Entry points and redirects

- `NewIssueMenu` “with assistant”, `ProjectAssistantMenu`, and any other
  `newIssueAssistantPath` callers navigate to the workspace new-issue path.
- `App.tsx` routes:
  - `assistant/new-issue` → `<Navigate>` to workspace `?new=1`
  - `assistant/issue/:issueId` → `<Navigate>` to
    `projectAuthoringSessionPath(slug, issueId)`
- Keep `IssueAssistantRoute` only if needed as a thin redirect host; prefer
  route-level redirects so the dedicated two-column page is unreachable.

### 5. KB in composer

No new KB UI for this flow:

- `ProjectAssistantPanel` already wires the composer KB button to
  `KnowledgeBaseModal` and exposes `onKnowledgeBaseControlChange` with
  `changedDocCount` for issue-bound sessions.
- Ephemeral new-issue (no identifier): open the same modal in project mode
  (Todos); after morph to `authoring-session`, changed-docs filter/badge apply
  as on other issue workspace tabs (per
  `2026-07-09-issue-kb-changed-docs-modal-design.md`).

### 6. Files likely touched

| Area | Files |
| --- | --- |
| Tab types | `tracker/src/lib/workspaceTabs/types.ts` (+ related tab helpers/tests) |
| Routes | `tracker/src/lib/workspaceRoutes.ts`, `tracker/src/App.tsx` |
| Workspace host | `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx` |
| Entry | `tracker/src/components/issues/NewIssueMenu.tsx`, `ProjectAssistantMenu.tsx` |
| Authoring shell | `IssueAuthoringPanel.tsx` (page-mode aside unused for this entry; may slim or leave for any remaining hosts) |
| Tests | focused unit tests for path helpers, tab open/morph, menu link, redirects |

## Error handling

- Create failure / missing identifier: keep `new-issue` tab; surface existing
  toast/error path from the assistant panel.
- Invalid `exec` after morph navigation: existing workspace handling for unknown
  identifiers applies.
- Duplicate `?new=1` navigations: idempotent focus of the single ephemeral tab.

## Testing (WSL-constrained)

Run **one** narrowly targeted test file or filter at a time; no full suite.

Minimum coverage:

1. `newIssueAssistantPath` / `projectNewIssueWorkspacePath` point at workspaces
   `?new=1`.
2. Workspace opens/focuses `new-issue` tab from that query; morph replaces it
   with `authoring-session` on create.
3. Entry menu link targets the new path.
4. Legacy assistant routes redirect.

## Success criteria

- From workspaces URL space, user can start “Nova issue”, chat in a centered
  column, open KB from the composer, and after issue creation land on the
  normal authoring session tab for that issue — without a docked KB/intro
  sidebar.
