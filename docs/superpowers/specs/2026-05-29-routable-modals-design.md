# Routable issues, filters, and modals (tracker SPA)

Date: 2026-05-29
Status: Approved (design)

## Problem

In the tracker SPA, opening an issue, the filters drawer, and the various
modals/dialogs only mutates local React state. Nothing is reflected in the URL,
so these views cannot be deep-linked, shared, bookmarked, or restored on
refresh. Filter *values* (`q`, `assignee`, `creator`) already live in query
params, but the drawer open-state and every modal do not.

## Goal

Generate a navigation route for each navigational surface so it can be reached
directly via URL:

- Issue detail (board + list views), including the active tab.
- Create-issue dialog.
- Workspace filters drawer (values stay in query params).
- Dev-environment panel.
- New-project wizard.
- Project-list filters drawer.

## Decisions

- **Path segments** (not query params) for modals/issues. Filter *values* stay
  as query params.
- **Issue tab in the URL**: `/issues/:identifier/:tab`.
- Board and list become children of a shared `ProjectWorkspaceLayout`.

## Route map

```
/projects                                  Projects index (grid)
/projects/new                              + New-project wizard
/projects/filters                          + Project filters drawer
/projects/:slug                            ProjectWorkspaceLayout (data + header)
/projects/:slug/board                      Board view
/projects/:slug/board/new-issue            + Create issue
/projects/:slug/board/filters              + Filters drawer (values in ?q=&assignee=&creator=)
/projects/:slug/board/dev-env              + Dev environment
/projects/:slug/board/issues/:id           Issue detail (summary)
/projects/:slug/board/issues/:id/:tab      Issue detail (specific tab)
/projects/:slug/list                       List view
/projects/:slug/list/new-issue             + Create issue
/projects/:slug/list/filters               + Filters drawer
/projects/:slug/list/issues/:id[/:tab]     Issue detail
```

Valid issue tabs: `summary | comments | blockers | agent | activity | terminal`.

## Architecture

- **`lib/workspaceRoutes.ts`** — pure path builders + parsers (testable, no React):
  `workspaceBasePath(slug, view)`, `issuePath(slug, view, id, tab?)`,
  `newIssuePath`, `filtersPath`, `devEnvPath`, `projectsNewPath`,
  `projectsFiltersPath`, plus `ISSUE_TABS` and `isIssueTab(value)`.
- **`WorkspaceProvider` (React context)** rendered by `ProjectWorkspaceLayout`.
  Loads project + `useIssueBoard` + agent executions + collapsed columns and
  exposes everything via `useWorkspace()`. Avoids threading data through nested
  Outlet contexts.
- **`ProjectWorkspaceLayout`** (`/projects/:slug`): renders shared `ProjectHeader`,
  the filters palette shortcuts, and `<Outlet/>`. Board/List are children.
- **`BoardPage` / `ListPage`**: render their view; clicking an issue/trigger
  navigates instead of setting local state; render `<Outlet/>` for modal routes.
- **Thin route components** (one responsibility each):
  - `IssueDetailRoute`: resolves issue from context, else fetches via `getIssue`
    (loading + not-found→toast+redirect); renders `IssueDrawer` with `tab` synced
    to URL; close → navigate to view base.
  - `NewIssueRoute`, `WorkspaceFiltersRoute`, `DevEnvRoute` (Sheet),
    `NewProjectRoute`, `ProjectFiltersRoute`.
- **Triggers become navigation**: New-issue button, Filters trigger, dev-env
  toggle, command-palette actions, issue cards, project wizard button.
- **`IssueDrawer`** gains controlled `tab`/`onTabChange` props (was fixed
  `defaultValue`).
- **`useBoardFiltersDrawer`** is reworked so `open` derives from the route and
  `setOpen`/`openAndFocusSearch` navigate (focus carried via location state).

## Edge cases

- Deep-link to a missing issue → toast + redirect to the view base.
- Router `basename` (`/tracker`) already handled by `BrowserRouter`; always use
  relative path helpers.
- Filter values remain query params so existing `issueFilters` behavior/tests
  are untouched.
- Project-index filter *values* live in query params (`?status=`, `?q=`) for
  shareable deep-links, matching the board/list filters; the drawer/wizard
  open-state is route-driven.

## Testing

- Unit-test `workspaceRoutes` builders/parsers.
- Component tests with `MemoryRouter` for `IssueDetailRoute` (resolve + fetch +
  not-found), tab sync, and trigger→navigation.
- Update existing `BoardFiltersDrawer`, `BoardPaletteShortcuts`, and
  `ProjectListPage` tests to the route-driven open-state.
- `npm run build` (tsc) + `npm test` must pass.
