# Phase 2: Backend Terminal Tab CRUD

## Context

Phase 1 introduced Jean-inspired tabbed workspaces in tracker using existing backend capabilities:

- Issue shell: `terminal:{project}:{issue}` via `POST .../issues/:identifier/terminal`
- Project shell: `terminal:devenv:{project}` via direct channel join
- Assistant session tabs: existing project session threads

Phase 1 intentionally avoids arbitrary terminal creation/closing because the Elixir terminal registry uses fixed tmux session names per scope.

## Goals

Add backend support for dynamic terminal tabs when the phase 1 UX proves the model:

1. List open terminal tabs for a project and/or issue
2. Create a new terminal tab with optional cwd and startup command
3. Rename a tab (UI title only or persisted metadata)
4. Close a tab and kill its tmux session
5. Optionally expose interactive dev-server terminals (`sym-dev-*`) through the same channel abstraction

## Proposed Backend Changes

### Registry extensions

Extend [`elixir/lib/symphony_elixir/terminal/registry.ex`](../../elixir/lib/symphony_elixir/terminal/registry.ex):

- Add tab-scoped session naming, e.g. `sym-tab-{project}-{tab_id}`
- Persist tab metadata (title, cwd, shell command, owner scope) in a GenServer or DB table
- Provide CRUD functions: `list_tabs/2`, `open_tab/3`, `close_tab/2`, `rename_tab/3`

### Channel extensions

Extend [`elixir/lib/symphony_elixir_web/channels/terminal_channel.ex`](../../elixir/lib/symphony_elixir_web/channels/terminal_channel.ex):

- Support topics like `terminal:tab:{project}:{tab_id}`
- Reuse existing input/resize/output events
- Push explicit `state` events on tab lifecycle changes

### REST API

Add tracker endpoints under `/api/tracker/v1/projects/:project_slug/terminal-tabs`:

- `GET` list tabs
- `POST` create tab
- `PATCH :tab_id` rename tab
- `DELETE :tab_id` close tab

Issue-scoped tabs can nest under `/issues/:identifier/terminal-tabs` if needed.

## Frontend Follow-Up

Once backend CRUD exists:

- Enable the disabled/hidden “New terminal” affordance in `TerminalWorkspacePanel`
- Map dynamic tabs through `useWorkspaceTabs` as closable entries
- Add dev-server tabs from `useIssueDevServers` as read-only or interactive depending on backend support

## Testing Requirements

- Elixir tests for registry CRUD and tmux lifecycle
- Channel tests for tab topics and error cases (`:tmux_unavailable`, invalid tab id)
- Tracker tests for opening/closing dynamic tabs and preserving canonical issue/project shells

## Non-Goals

- Replacing tmux with native PTY streaming (separate initiative)
- Persisting arbitrary UI tab order across browsers before product need is validated
- Merging assistant session state with terminal session state
