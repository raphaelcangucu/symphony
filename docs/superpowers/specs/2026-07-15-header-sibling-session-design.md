# Header — one-click sibling session

**Date:** 2026-07-15  
**Status:** implemented  
**Primary surface:** Workspaces session tab bar (`WorkspaceTabBar` in
`ProjectSessionsWorkspace`)  
**Related:**  
[`2026-07-15-new-session-modal-design.md`](./2026-07-15-new-session-modal-design.md)
(sidebar “Nova sessão” modal — separate, dialog-based create),  
[`2026-07-14-sidebar-sessions-perf-design.md`](./2026-07-14-sidebar-sessions-perf-design.md)
(session/workspace metadata for sidebar)

## 1. Problem

On an open project/issue assistant thread (e.g.
`/tracker/projects/advising/workspaces/8006`), starting a **second session in
the same workspace** requires leaving the header and using the sidebar modal
or workspaces list. That is too slow when the user just wants another thread
to run a parallel command in the same cwd.

## 2. Goals

1. Add a **`+` button** on the sessions header tab bar that creates a **sibling
   session** of the active assistant thread in **one click** (no dialog).
2. **Full mirror:** reuse the current thread’s `workspacePath`, `agentKind`,
   and scope (`project_session` vs `issue_session` + same issue id).
3. Open the new thread immediately (new tab + navigate to
   `/projects/:slug/workspaces/:newThreadId`).
4. Extract a small shared helper so a utility-toolbar duplicate can reuse the
   same create path later.

## 3. Non-goals

- Utility-cluster duplicate icon in v1 (reserved for a follow-up).
- Opening or changing `SidebarNewSessionFlow` / the new-session modal.
- Creating a new workspace or picking a different cwd.
- Copying the previous session’s title or transcript.
- Authoring/execution-only tabs as create sources.
- Broad E2E suites (targeted unit + component tests only).

## 4. Decisions

| Topic | Choice |
|-------|--------|
| Interaction | **A** — one click create + open; no confirm dialog |
| Placement (v1) | **`+` after tabs** on `WorkspaceTabBar` (primary) |
| Placement (later) | Optional duplicate in session utility toolbar via same helper |
| Inheritance | **Full mirror** — workspace + agent + scope |
| Title | Omit / default new-session title; do **not** copy old title |
| Missing `workspacePath` | Create in same scope/issue without forcing a path; toast on API failure |
| Active surface | Render `+` only when active tab is an **assistant session** |

## 5. Placement & click behavior

- Render `+` via `WorkspaceTabBar`’s `trailing` slot from
  `ProjectSessionsWorkspace`.
- **Show and enable** only when `activeTab.kind === "assistant-session"`.
- **Omit** the control entirely on sessions-list, authoring-session, and
  execution-session tabs (no disabled placeholder).
- Click: create sibling → `openAssistantSession(newId, title)` (existing open
  tab + `navigate(projectSessionPath(...))` path).
- While the create request is in flight: disable `+`, brief loading affordance,
  ignore extra clicks.

## 6. Create payload (full mirror)

Resolve active thread metadata (`useAssistantThreadMetadata` /
`getAssistantThread` when the optimistic recent seed lacks `workspacePath`):

| Current thread | API | Fields sent |
|----------------|-----|-------------|
| No non-blank `issueIdentifier` | `createProjectSessionThread` | `workspacePath?`, `agentKind?` |
| Non-blank `issueIdentifier` | `createIssueSessionThread` | that issue id, `workspacePath?`, `agentKind?` |

Routing uses **`issueIdentifier`**, not the scope string alone, so a thread
that is issue-bound is always mirrored as an issue session even if scope
metadata is incomplete.

- Do not pass a custom title (backend / existing default “Nova sessão” path).
- Do not set `isolatedWorkspace` / `useParentWorkspace` when mirroring an
  explicit `workspacePath` (same rules as existing create helpers).
- Fail fast in the helper if `projectSlug` is blank or (for issue route) the
  issue id is blank after trim.

## 7. Edge cases & UX

- **No assistant thread active:** no create call; control unavailable.
- **Failure:** toast with error message; stay on the current tab.
- **Double-click / concurrent:** single in-flight guard.
- **i18n:** aria-label / title for “Nova sessão” / “New session”; reuse
  existing sidebar/session strings when they already fit.
- Optimistic recent rows often have `workspacePath: null` — prefer fetched
  thread metadata before create when a path is expected.

## 8. Architecture

```text
ProjectSessionsWorkspace
  └─ WorkspaceTabBar trailing: [+]
       └─ onClick → createSiblingSession(threadMeta)
            ├─ createProjectSessionThread(...)  OR
            └─ createIssueSessionThread(...)
       └─ openAssistantSession(newThread.id, defaultTitle)
```

**Expected files:**

- `tracker/src/lib/createSiblingSession.ts` — pure decision + API call from
  thread metadata (testable without React).
- `tracker/src/components/sessions/ProjectSessionsWorkspace.tsx` — wire `+`,
  loading state, toast, navigate.
- Locale keys in `tracker/locales/{en,pt-BR}/tracker.json` if missing.
- Tests under `tracker/src/lib/__tests__/` and a narrowly targeted workspace /
  tab-bar test.

## 9. Testing

WSL constraint: one narrowly targeted test file/filter at a time.

1. **Helper unit** — project vs issue payload; omits title; optional
   `workspacePath` / `agentKind`; rejects invalid metadata with a clear error.
2. **UI** — `+` on assistant tab calls create + navigates; disabled while in
   flight; unavailable on list tab.

## 10. Out of scope follow-ups

- Duplicate control in `IssueWorkingTreeToolbar` trailing / project-session
  chrome.
- Keyboard shortcut for sibling create.
- Prefilling the sidebar modal from the header (explicitly not this path).
