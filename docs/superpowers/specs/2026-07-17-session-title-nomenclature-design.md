# Session title nomenclature — per-scope defaults, auto-title, rename lock

**Date:** 2026-07-17
**Status:** Draft (ready for review)
**Surfaces:** `Thread.title`, `TitleGenerator`, thread create paths in `History`,
sidebar rename (`sidebarRenameRequest` / `useSidebarActions`), Workspaces /
project sessions list, workspace tab bar (`WorkspaceTabBar`,
`resolveWorkspaceTabPresentation`)
**Related:**
[`2026-07-17-per-session-identity-logs-design.md`](./2026-07-17-per-session-identity-logs-design.md)
(session = `thread:<id>`),
[`2026-07-17-workspaces-threads-only-design.md`](./2026-07-17-workspaces-threads-only-design.md)
(threads as list source of truth)

## 1. Problem

Session titles are inconsistent across scopes (issue title, generic
"Issue session" / "Project session", explore/freeform fallbacks, auto-title).
Operators cannot reliably rename a **session**: sidebar "Rename" on an
issue-backed session calls `rename-issue` (updates the tracker issue title)
instead of `rename-thread` (updates `Thread.title`), so the session label
appears unchanged.

Workspace tabs compound the problem: `resolveWorkspaceTabPresentation` labels
issue-linked tabs with **only** the issue identifier (`GAM-20`), so two open
sessions for the same issue look identical. Tabs also use a generic active/inactive
dot instead of the sidebar `ChatStatusIcon` (kind + status color).

## 2. Goals

1. Canonical **initial** title per thread scope, persisted on `Thread.title`.
2. Auto-title may replace that title until the user renames once; then lock.
3. Session rename always targets the thread when a `threadId` exists.
4. One readable grammar across sidebar, workspaces list, and **tabs**.
5. Tabs show the session title (not bare identifier) and the same status icon
   treatment as the sidebar.

## 3. Non-goals

- Inventing a new icon set (reuse `ChatStatusIcon` + existing status colors).
- Localizing type prefixes (`Chat` / `Run` / … stay English for this change).
- Hard delete, archive policy, or workspace card header redesign beyond
  reading `thread.title`.
- Changing issue rename UX in the issue drawer / board (still renames the
  issue, not the session).

## 4. Decisions

| Topic | Choice |
|-------|--------|
| What we standardize | Session **title** (`Thread.title`) + tab presentation |
| Grammar | `{Type} · {Context}` with separator ` · ` |
| Issue context | `{identifier} · {issue title}` |
| Issue chat vs run | Distinct type prefixes: `Chat ·` vs `Run ·` |
| Storage | Persist full string on create (approach A — not UI-only projection) |
| Auto-title | Allowed until first user rename; then locked |
| Explicit "Generate name" | May overwrite even after lock (user intent) |
| Rename target | Session node → `rename-thread` when `threadId` present |
| Tab label | Prefer stored session title (`tab.title` / thread title) |
| Tab leading icon | `ChatStatusIcon` (sessionKind + status), same as sidebar |

## 5. Initial titles by scope

| Scope | Initial `Thread.title` |
|-------|------------------------|
| `issue_session` | `Chat · {ID} · {issue title}` |
| `issue_execution` | `Run · {ID} · {issue title}` |
| `project_session` | `Workspace · {workspace display name}` |
| `workspace_session` | `Workspace · {workspace display name}` |
| `project_explore` | `Explore · {project name or slug}` |
| `freeform` | `Chat` |
| `kb` | `KB · {page title or path basename}` |

Rules:

- Missing issue title → use identifier only after the type prefix
  (`Chat · GAM-20`). Missing workspace name → path basename.
- No ordinal suffixes (`Session 2`). Sibling sessions may share an initial
  title until auto-title or rename.
- Truncate with existing sidebar title max (160 graphemes) at write time.
- Prefer existing create-path helpers in `History` so every creator applies
  the same defaults (issue session dialog, orchestrator execution thread,
  workspace session, explore, freeform, KB).

Legacy scopes `issue` / `project` (if still created): treat like
`issue_session` / project explore-or-assistant context respectively only if
those create paths remain; otherwise leave unchanged.

## 6. Lifecycle

```
create → initial title on Thread
     → (first turn with enough context) auto-title replaces full title
     → user rename → title_user_set=true → auto-title / silent overwrite stop
     → explicit "Generate name" → may replace title (does not clear lock
        unless we choose to keep lock; lock stays true so future auto still skips)
```

### 6.1 Metadata

| Key | Meaning |
|-----|---------|
| `title_auto_eligible` | Thread may receive auto-title (existing) |
| `title_auto_generated_at` | Auto-title already ran (existing) |
| `title_user_set` | User renamed via sidebar/API; blocks auto overwrite |

On successful user title PATCH (`update_thread_sidebar_metadata` / tracker
PATCH with `title`): set `title_user_set: true`. The eligibility gate alone
blocks further auto overwrite; do not require clearing `title_auto_eligible`.

### 6.2 Auto-title eligibility (change)

**Today:** `title_auto_eligible` + no `title_auto_generated_at` +
`generic_title?(title)` against a fixed MapSet (`"Issue session"`, …).

**New:** `title_auto_eligible` + no `title_auto_generated_at` +
`title_user_set` is not true.

Rich initials like `Chat · GAM-20 · Fix login race` remain auto-eligible.
`generic_title?/1` may remain for prompts/UI hints but must **not** gate auto
overwrite after this change.

Auto-title replaces the **entire** title (prefix may disappear). That is
intentional: after content exists, the semantic title is more useful than the
type prefix.

### 6.3 Magic / generate name

Explicit generate-title action may overwrite a user-set title. It should not
clear `title_user_set` (auto still never runs again without a new eligible
flag).

## 7. Rename bugfix

`sidebarRenameRequest` today:

- session with `issueIdentifier` → `rename-issue` (wrong for session title)
- else → `rename-thread`

**Required:** if `node.kind === "session"` and `node.threadId != null` →
always `rename-thread`. Do not route session rename through issue title
updates.

Dialog `targetType` for that path must be `"thread"` (not `"issue"`), so copy
and grapheme limits match session titles.

Issue title editing remains available from issue surfaces, not from session
row rename.

## 8. Display

### 8.1 Lists / sidebar / workspace cards

Show `thread.title` as stored (trimmed); fallback only when null/blank
(e.g. `Session {id}`), not a second parallel naming scheme.
Workspace card activity label continues to use newest thread title
(threads-only design).

### 8.2 Workspace tabs (label)

**Today:** issue-linked tabs force `label = issueIdentifier` and bury the
session title in the tooltip only.

**Required:** tab label = session title (`tab.title`, kept in sync with
`Thread.title` on open/rename/auto-title updates).

- Non-blank `tab.title` wins even when an issue identifier exists.
- If `tab.title` is blank, fall back to issue identifier, then a generic
  `Session`.
- Tooltip may still add issue identifier / issue title when they are not
  already contained in the label (optional richness; do not hide the session
  name from the visible label).
- Existing tab max-width / truncate stays; long titles truncate with ellipsis.
- Keep `tab.title` updated when the thread title changes (rename, auto-title,
  generate name) so open tabs do not stay stuck on stale labels.

Example: two tabs for `GAM-20` show
`Chat · GAM-20 · Fix login race` and `Run · GAM-20 · Fix login race` (or
post-auto-title semantic names), not two bare `GAM-20`.

### 8.3 Workspace tabs (icon)

**Today:** `WorkspaceTabBar` renders a small emerald/muted circle for
active/inactive only.

**Required:** for session tabs (`assistant-session`, and any other tab kinds
that map to a thread/session), replace that dot with `ChatStatusIcon` using
the same inputs as the sidebar row (`sessionKind` / scope mapping,
`executionMode` when known, `statusKind` / `aggregateStatus`,
`needsAttention` / review when available).

- Color and glyph must match sidebar semantics (chat vs execution vs plan/build
  modes; running / idle / attention).
- Canonical list tab (`Workspaces`) and non-session tabs may keep a simple
  neutral indicator or no status icon.
- Wire presentation through tab bar props (icon + label), resolved from
  project-sessions / recents data already used for sidebar status — do not
  invent a second status model.

## 9. Out of scope / deferred

- i18n of type prefixes
- Backfilling titles for existing threads (optional follow-up: leave as-is;
  rename/auto-title apply going forward)
- Distinguishing multiple concurrent runs in the initial title without
  auto-title
- Redesigning `ChatStatusIcon` visuals themselves

## 10. Tests (WSL: one file/filter at a time, sequential)

- `title_generator` / history: new eligibility gate; `title_user_set` blocks
  auto; create paths emit scope defaults
- Tracker: `sidebarRenameRequest` / capabilities tests — issue-backed session
  with `threadId` → `rename-thread`
- `workspaceTabs/presentation`: issue-linked tab label prefers session title
  over bare identifier
- Tab bar / project-sessions: session tab renders `ChatStatusIcon` (not the
  active-only emerald dot) when status props are provided
- Optional: one controller test that PATCH title sets `title_user_set`

## 11. Approval notes

Agreed in design discussion:

1. Standardize session titles (not inventing new type badges).
2. Auto-title until first rename, then lock.
3. Context-based initials; issue = `ID · issue title`.
4. Prefix type for issue chat vs run (`Chat ·` / `Run ·`).
5. Approach A: persist prefix + context on `Thread.title`.
6. Tabs show session names (differentiate same-issue sessions) and sidebar-equivalent
   `ChatStatusIcon` with status color.
