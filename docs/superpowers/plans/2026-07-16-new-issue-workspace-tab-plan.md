# New Issue Workspace Tab Implementation Plan

**Status:** implemented (2026-07-16)

**Goal:** Host ephemeral “new issue with assistant” as a centered workspace tab with composer KB, replacing the dedicated two-column `/assistant/new-issue` page.

**Architecture:** Add workspace tab kind `new-issue` + `?new=1` deep link in `ProjectSessionsWorkspace`. Reuse `IssueAuthoringPanel` compact (no aside). On issue create, morph to existing `authoring-session` tab. Redirect legacy assistant authoring routes; point `newIssueAssistantPath` at workspaces.

**Tech Stack:** React, React Router, Vitest, existing workspaceTabs + ProjectAssistantPanel / KnowledgeBaseModal.

**Spec:** `docs/superpowers/specs/2026-07-16-new-issue-workspace-tab-design.md`

**WSL:** Run one targeted test file or filter at a time; never the full suite.

---

### Task 1: Routes + tab factory

**Files:**
- Modify: `tracker/src/lib/workspaceRoutes.ts`
- Modify: `tracker/src/lib/__tests__/workspaceRoutes.test.ts`
- Modify: `tracker/src/lib/workspaceTabs/types.ts`
- Modify: `tracker/src/lib/workspaceTabs/persistence.ts`
- Modify: `tracker/src/lib/workspaceTabs/__tests__/reducer.test.ts` (optional open-idempotency for new-issue)

**Steps:**
1. Add failing tests: `projectNewIssueWorkspacePath("acme")` → `/projects/acme/workspaces?new=1`; `newIssueAssistantPath` equals that; `issueAssistantPath` still builds legacy path (used by redirects) OR also document redirect-only.
2. Implement `projectNewIssueWorkspacePath`; change `newIssueAssistantPath` to return it.
3. Add `NewIssueTab`, `NEW_ISSUE_TAB_ID = "new-issue"`, `createNewIssueTab(title)`.
4. Persist/parse `new-issue` (and `authoring-session` if missing) in persistence.
5. Run: `cd tracker && npx vitest run src/lib/__tests__/workspaceRoutes.test.ts`

### Task 2: Workspace host — open, select, morph

**Files:**
- Modify: `tracker/src/pages/ProjectSessionsPage.tsx`
- Modify: `tracker/src/components/sessions/ProjectSessionsPanel.tsx`
- Modify: `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx`
- Modify: `tracker/src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx`

**Steps:**
1. Add failing tests: URL `?new=1` opens new-issue tab; create callback morphs to authoring; `exec` wins over `new`.
2. Pass `activeNewIssue` from page (`new=1` and no winning `exec` authoring/execution).
3. Effect opens `createNewIssueTab`; `handleSelectTab` / close sync URL; render compact `IssueAuthoringPanel` with `onIssueCreated` morph.
4. Mock `IssueAuthoringPanel` in tests for create button.
5. Run: `cd tracker && npx vitest run src/components/sessions/__tests__/ProjectSessionsPanel.test.tsx -t "new issue"`

### Task 3: Redirects + entry points

**Files:**
- Modify: `tracker/src/App.tsx`
- Modify: `tracker/src/components/workspace/IssueAssistantRoute.tsx` (redirect-only or remove from routes)
- Modify: `tracker/src/components/issues/__tests__/NewIssueMenu.test.tsx` if path assertions exist

**Steps:**
1. Replace assistant/new-issue and assistant/issue/:id routes with Navigate to workspace paths.
2. Confirm NewIssueMenu / ProjectAssistantMenu use `newIssueAssistantPath` (no code change if helper updated).
3. Run NewIssueMenu test file if it asserts hrefs.

### Task 4: Smoke verify

**Steps:**
1. One more targeted run of workspaceRoutes + ProjectSessionsPanel new-issue tests.
2. Manual check optional: `/tracker/projects/<slug>/workspaces?new=1`.
