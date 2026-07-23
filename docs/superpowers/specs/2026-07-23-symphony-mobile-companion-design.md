# Symphony Mobile Companion Design

Date: 2026-07-23

## Context

The Symphony tracker is currently a React/Vite web application backed by the
Phoenix tracker API and Phoenix Channels. The requested product is a dedicated
iOS and Android companion app with as much useful parity as possible with the
Orca mobile app.

The Orca repository was inspected at commit
`8685cdb3fbd4a1bce6d76fbbb704737d54817842`. Its mobile app is an Expo/React
Native application with these major surfaces:

- pairing and connection management;
- a dashboard with host health, activity, resumable work, usage, and quick
  actions;
- worktree/session lists and creation;
- a task browser;
- agent conversation and terminal interaction;
- source control, diff review, pull requests, files, and browser preview;
- notifications, voice/dictation, diagnostics, and settings.

The local Orca checkout is a development reference only. No Orca source code or
assets will ship in Symphony Mobile. This keeps the implementation aligned with
Symphony's own API model and avoids accidental product or protocol coupling.

## Approaches Considered

### 1. Fork Orca Mobile and replace its transport

This gives early visual similarity, but most Orca screens are tightly coupled
to Orca's encrypted WebSocket RPC schema, worktree identifiers, terminal
protocol, and desktop pairing lifecycle. Replacing those dependencies would
leave a large fork that is difficult to validate and keep current.

### 2. Build a Symphony-native Expo app using Orca's product patterns

This uses the same broad technical shape as Orca—Expo Router, React Native,
native secure storage, native notifications, and mobile-first navigation—but
binds directly to Symphony's tracker REST API and Phoenix Channels. It provides
high UX parity without importing the wrong domain model. This is the selected
approach.

### 3. Wrap the existing tracker web UI

A PWA or WebView shell would be quicker, but it would preserve desktop-first
interaction patterns, offer weaker native notification/credential behavior,
and make the requested Orca-like navigation difficult to achieve.

## Product Goals

1. Deliver a real Expo/React Native app for iOS and Android.
2. Let a user connect securely to one or more Symphony tracker servers.
3. Make the most important remote workflows complete on a phone:
   - see system and project activity;
   - find, create, and update tasks;
   - monitor and steer coding-agent sessions;
   - respond to approvals and user questions;
   - inspect diffs, pull requests, files, terminals, and previews;
   - receive actionable notifications.
4. Mirror Orca's information density, dark graphite visual language, touch
   targets, drawers, cards, and focused full-screen work surfaces while keeping
   Dev10x/Symphony branding.
5. Reuse the tracker API as the source of truth rather than introducing a
   second business-logic implementation.
6. Continue to function sensibly on an unreliable mobile network using cached
   read models, explicit stale/offline states, and reconnecting channels.

## Non-goals

- Embedding the existing tracker website in a WebView.
- Copying Orca branding, illustrations, proprietary connection assumptions, or
  source code.
- Replacing the existing browser tracker.
- Exposing a tracker that is not already reachable from the phone. Symphony's
  existing tunnel feature remains the supported remote-access mechanism.
- Reimplementing unsupported backend capabilities only in the client. Missing
  server contracts are added to Phoenix first.

## Information Architecture

### Root navigation

The root native stack contains:

- `welcome`: first-run explanation and connection setup;
- `connections`: saved Symphony server profiles and health;
- `home`: dashboard for the active connection;
- `project/:projectSlug`: project overview;
- `tasks`: searchable/filterable task list;
- `issue/:projectSlug/:identifier`: task details and actions;
- `session/:threadId`: assistant session;
- `terminal`, `preview`, `files`, `diff`, and `pull-request`: focused workspace
  tools;
- `settings`, `notifications`, `connection-log`, and `troubleshoot`.

The main application uses a bottom tab bar for Home, Tasks, Sessions, and
Settings. Deep work surfaces use a native stack above the tabs. A compact
connection switcher in the Home header plays the role of Orca's host switcher.

### Mapping Orca concepts to Symphony

| Orca mobile concept | Symphony Mobile equivalent |
| --- | --- |
| Desktop host | Saved Symphony tracker connection |
| Host connectivity | `/api/health`, authenticated `/viewer`, and socket state |
| Worktree | Symphony workspace/session with `workspace_id` and `workspace_path` |
| Worktree agent | Assistant thread / issue execution |
| Tasks | Tracker issues across projects |
| Session | Assistant thread timeline and composer |
| Agent history | Project session history and archived threads |
| Terminal | Existing `terminal:*` Phoenix channel |
| Browser | Issue/thread dev-server preview |
| Source control | Workspace diff, files, commit, and push APIs |
| Pull request | Existing issue/project pull-request APIs |
| Account usage | `/settings/agents/usage` |
| Mobile pairing | Tracker URL plus bearer token, stored in SecureStore |

## Core User Flows

### Connect

The user enters or scans a Symphony tracker URL and tracker bearer token. The
app normalizes the URL, calls `/api/health`, then calls the authenticated
`/api/tracker/v1/viewer` endpoint. Only a fully validated profile is saved.
Secrets are stored in `expo-secure-store`; non-secret profile metadata and the
active profile id are stored in AsyncStorage.

The connection setup also accepts a deep link:

```text
symphony://connect?url=https%3A%2F%2Fexample.test&token=<tracker-token>
```

The token is never logged, rendered after validation, placed in analytics, or
stored in AsyncStorage.

### Home

The dashboard follows Orca's mobile hierarchy:

- compact brand and connection-state header;
- greeting and aggregate cards for projects, active sessions, tasks needing
  attention, and agent usage;
- current connection card;
- resumable/recent sessions;
- account usage;
- quick actions for new task, new session, connection switch, and refresh.

Home aggregates existing project, recent-session, assistant-thread, agent
execution, and usage APIs. Cards show whether data is live, cached, or
unavailable.

### Tasks

The Tasks tab aggregates issues from the selected project or all projects. It
offers project, status, priority, assignee, and search filters in bottom
drawers. Rows show status, title, identifier, priority, assignee, agent state,
labels, and last activity. Issue detail supports editing, comments, blockers,
subtasks, agent dispatch/resume, and opening its active workspace tools.

### Sessions

The Sessions tab groups running, needs-attention, recent, pinned, and archived
threads. A session screen renders the assistant timeline, streaming deltas,
tool activity, the current goal/turn state, approvals, user questions, queued
messages, attachments, model/effort/mode selection, and resume/interrupt
controls.

The initial session implementation supports the common read/compose/stream
path. Approval cards, user questions, attachments, and goal controls are added
as the same Phoenix channel contract is adopted incrementally.

### Workspace tools

From an issue or session the user can open:

- a terminal driven by the existing Phoenix terminal channel;
- a preview using the primary ready dev-server URL;
- file search, tree, source preview, and Markdown/image preview;
- diff stats, file list, unified patch, commit, and push;
- pull-request state, checks, update-branch, retry, fix, and merge actions.

Any missing thread-scoped file or terminal endpoint is added to the backend
with the same workspace path sandboxing used by the browser tracker.

### Notifications and diagnostics

Native push registration is distinct from the browser Push API. The backend
will gain a device-token subscription contract for Expo push tokens while
retaining the existing Web Push contract. Notifications deep-link to a task or
session.

The app exposes connection diagnostics, request/socket history with secrets
redacted, reconnect, token replacement, and profile removal.

## Technical Architecture

### Repository layout

The new application lives in `mobile/` as an independent npm package:

```text
mobile/
├── app/                  # Expo Router routes
├── assets/               # Dev10x/Symphony app assets
├── src/
│   ├── api/              # REST client, DTO validation, domain mappers
│   ├── auth/             # connection profiles and SecureStore
│   ├── components/       # reusable native UI
│   ├── features/         # home, tasks, sessions, workspace tools, settings
│   ├── realtime/         # Phoenix socket/channel lifecycle
│   ├── state/            # small Zustand stores
│   ├── theme/            # tokens and themed primitives
│   └── test/             # test helpers and fixtures
├── app.config.ts
├── package.json
└── tsconfig.json
```

Feature modules own their API hooks, presentation, and tests. Shared API code
contains no React dependencies. Screen files stay thin and compose feature
components.

### Data and state

- TanStack Query owns server data, retries, invalidation, offline cache, and
  optimistic mutations.
- Zustand owns only local UI/session state such as active connection,
  connection drawer state, and pending composer drafts.
- SecureStore owns tokens.
- AsyncStorage persists safe connection metadata, Query cache, and drafts.
- Phoenix Channels deliver project changes, assistant streaming, agent
  execution changes, and terminal events. Channel events update or invalidate
  Query data.

### Transport

Every REST request uses:

```http
Authorization: Bearer <tracker token>
X-Symphony-Locale: <locale>
```

The base URL is profile-specific and the tracker prefix remains
`/api/tracker/v1`. A single client factory binds a profile to request helpers.
Requests use a 30-second default timeout and abort on screen unmount.

Phoenix connects to `<profile-origin>/socket` with `token` and `locale` params.
The socket manager exposes connection state and reference-counted channel
leases so switching screens does not create duplicate channels.

### Theme

The visual system is inspired by Orca's graphite mobile palette while using
Symphony branding:

- base `#111111`, panel `#1A1A1A`, raised `#242424`;
- subtle border `#2A2A2A`;
- primary text `#E8E8E8`, secondary `#969696`, muted `#606060`;
- semantic green/amber/red/purple only for state;
- blue for links and selection;
- 44-point minimum interactive targets, 14-point cards, 8-point rhythm;
- light theme uses the same semantic tokens rather than hard-coded component
  colors.

Typography uses the platform system font for UI and the platform monospace font
for code, paths, diffs, and terminal content.

## Error Handling and Offline Behavior

- Connection validation distinguishes unreachable server, invalid URL, invalid
  token, incompatible response, and timeout.
- Screen-level errors retain stale cached content where available and expose a
  retry action.
- Mutations are not silently queued unless the server contract is idempotent.
  Failed writes remain visible with retry/discard affordances.
- Socket state is always visible on session and terminal screens.
- Tokens and authorization headers are redacted from all diagnostics.
- Unsupported server capabilities render an explanatory state rather than a
  broken control.

## Accessibility

- Every icon-only control has a localized accessibility label.
- Touch targets are at least 44×44 points.
- Status is conveyed by text/icon as well as color.
- Dynamic type is supported without clipping critical controls.
- Lists expose headings and logical reading order.
- Reduce Motion disables decorative transitions but preserves progress
  feedback.

## Testing and Validation

- Vitest covers URL normalization, auth/profile storage contracts, DTO mapping,
  API errors, query behavior, and reducers.
- React Native Testing Library covers screens, navigation triggers, offline
  states, and mutations.
- Mock Service Worker or fetch fixtures provide deterministic REST contracts.
- Phoenix channel adapters are tested behind a small transport interface.
- Expo typecheck and lint run on every change.
- Maestro smoke flows cover connect, dashboard, task navigation, session
  messaging, and connection switching on Android and iOS simulators.
- Manual validation compares phone screenshots against the Orca-inspired
  reference hierarchy at 390×844 and 430×932.

## Delivery Slices

The full parity target spans independent subsystems and is delivered in these
working increments:

1. **Foundation and core companion:** Expo shell, secure connection profiles,
   theme, home, projects, task list, session list, read/compose assistant chat.
2. **Task operations:** issue detail/edit/create, comments, blockers, subtasks,
   dispatch, and goal control.
3. **Session control:** streaming tool cards, approvals, questions, attachments,
   model/mode controls, resume, interrupt, and history.
4. **Workspace tools:** terminal, preview, files, source control, diff, and pull
   requests.
5. **Native services:** push notifications, deep links, QR connection,
   dictation, diagnostics, offline cache, and release automation.
6. **Parity hardening:** accessibility, performance, tablet layout, visual
   regression, store builds, and end-to-end evidence.

Each slice must run on both iOS and Android and must use live Symphony contracts
before the next slice is considered complete.

## Acceptance Criteria

The overall objective is complete only when:

1. `mobile/` builds as an Expo app for iOS and Android.
2. A valid Symphony URL/token profile can be saved securely and re-opened.
3. Home exposes connection health, aggregate activity, recent/resumable work,
   usage, and quick actions.
4. Projects, tasks, sessions, and their important states are navigable and
   refresh in real time.
5. A user can create/update a task and steer an assistant session from mobile.
6. Terminal, preview, files, diff/source-control, and pull-request workflows are
   usable from the relevant workspace.
7. Native notifications and deep links open the correct task/session.
8. Offline, reconnecting, invalid-auth, and incompatible-server states are
   explicit and recoverable.
9. Automated tests, typecheck, lint, Expo doctor, and mobile smoke flows pass.
10. Visual and interaction review confirms the app preserves the reference
    hierarchy and density without copying Orca branding or assets.

