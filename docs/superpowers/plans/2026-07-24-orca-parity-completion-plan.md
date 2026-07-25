# Orca-Inspired Mobile Parity Completion Implementation Plan

**Goal:** Complete Symphony Mobile's Orca-inspired operational workflows while preserving the approved clean, Codex-style session shell.

**Architecture:** Extend the injected `TrackerClient` with small domain-specific API modules and keep React Query responsible for server state. Add a root drawer-style menu and focused Expo Router screens for tasks, workspace tools, source control, notifications, and diagnostics. Phoenix adapters remain isolated behind testable interfaces for assistant control and terminal streaming.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo Router, TanStack Query, Zod, Phoenix Channels, Expo Notifications, Expo Speech Recognition, Vitest, Jest, React Native Testing Library, Android E2E.

---

## Delivery contract

The work is complete only when every acceptance criterion in
`docs/superpowers/specs/2026-07-23-symphony-mobile-companion-design.md` has
direct automated or runtime evidence. The existing session experience remains
the root surface; Orca-inspired operational tools are opened from the root menu,
issue detail, or session toolbar.

### Task 1: Root navigation and task operations

**Files:**

- Modify: `mobile/src/api/contracts.ts`
- Modify: `mobile/src/api/client.ts`
- Modify: `mobile/src/api/client.test.ts`
- Create: `mobile/src/features/tasks/task-filters.ts`
- Create: `mobile/src/features/tasks/task-filters.test.ts`
- Create: `mobile/src/features/tasks/TasksScreen.tsx`
- Create: `mobile/src/features/tasks/TasksScreen.test.tsx`
- Create: `mobile/src/features/tasks/TasksRoute.tsx`
- Create: `mobile/src/features/tasks/IssueScreen.tsx`
- Create: `mobile/src/features/tasks/IssueScreen.test.tsx`
- Create: `mobile/src/features/tasks/IssueRoute.tsx`
- Create: `mobile/src/features/navigation/RootMenu.tsx`
- Modify: `mobile/src/features/sessions/SessionLibraryScreen.tsx`
- Modify: `mobile/src/features/sessions/SessionLibraryRoute.tsx`
- Create: `mobile/app/tasks.tsx`
- Create: `mobile/app/issue/[projectSlug]/[identifier].tsx`

- [x] **Step 1: Write failing REST contract tests**

Add tests proving `issues`, `issue`, `createIssue`, `updateIssue`, `comments`,
`createComment`, `blockers`, `dispatchIssue`, and `goalControl` bind the active
profile, encode route segments, map snake_case DTOs, and use the correct HTTP
method.

- [x] **Step 2: Run the API tests and verify RED**

Run: `cd mobile && npm run test:unit -- src/api/client.test.ts`

Expected: FAIL because the issue methods do not exist.

- [x] **Step 3: Implement issue contracts and client methods**

Use `IssueSummary`, `IssueDetail`, `IssueComment`, `IssueFormOptions`, and
`IssueMutationInput` as the mobile-facing contracts. Extend request methods to
support `PATCH` and `DELETE`. Every mutation unwraps `{data: ...}` and maps its
response before returning.

- [x] **Step 4: Run API tests and verify GREEN**

Run: `cd mobile && npm run test:unit -- src/api/client.test.ts`

Expected: PASS.

- [x] **Step 5: Write failing task filter and screen tests**

Prove search is case/diacritic-insensitive across title, identifier, labels and
assignee; prove filters for project, status and priority compose; prove the
screen opens issue detail, retains stale rows on refresh failure, and exposes
create/edit/comment/dispatch actions.

- [x] **Step 6: Run task tests and verify RED**

Run:
`cd mobile && npm run test:unit -- src/features/tasks/task-filters.test.ts && npm run test:ui -- src/features/tasks`

Expected: FAIL because the modules do not exist.

- [x] **Step 7: Implement root menu, task list and issue detail**

The root menu contains Tasks, Connections, Notifications, Diagnostics and
Settings. `TasksRoute` queries all selected projects in parallel. `IssueRoute`
loads detail, comments and blockers, invalidates issue/list keys after writes,
and links to the active session and workspace tools.

- [x] **Step 8: Run task tests and typecheck**

Run:
`cd mobile && npm run test:unit -- src/features/tasks && npm run test:ui -- src/features/tasks && npm run typecheck`

Expected: PASS.

- [x] **Step 9: Commit**

Commit message: `feat(mobile): add Orca-style task operations`

### Task 2: Assistant approvals, questions and session control

**Files:**

- Modify: `mobile/src/realtime/assistant-session.ts`
- Modify: `mobile/src/realtime/assistant-session.test.ts`
- Modify: `mobile/src/features/sessions/session-reducer.ts`
- Modify: `mobile/src/features/sessions/session-reducer.test.ts`
- Modify: `mobile/src/features/sessions/SessionScreen.tsx`
- Modify: `mobile/src/features/sessions/SessionScreen.test.tsx`

- [x] **Step 1: Write failing adapter and reducer tests**

Prove `approval_required`, `user_input_required`, tool activity, queued
messages, goal state, interrupt and resume events become explicit timeline
state. Prove approval and question submissions push `submit_approval` and
`submit_user_input` with the server request id.

- [x] **Step 2: Run tests and verify RED**

Run:
`cd mobile && npm run test:unit -- src/realtime/assistant-session.test.ts src/features/sessions/session-reducer.test.ts`

Expected: FAIL on the new event/state assertions.

- [x] **Step 3: Implement adapter, state and accessible cards**

Approval cards expose Approve and Cancel. Question cards support every server
question and preserve entered answers until acknowledged. Session controls
expose resume/interrupt only when allowed by the current state.

- [x] **Step 4: Run tests and verify GREEN**

Run:
`cd mobile && npm run test:unit -- src/realtime/assistant-session.test.ts src/features/sessions/session-reducer.test.ts && npm run test:ui -- src/features/sessions/SessionScreen.test.tsx`

Expected: PASS.

- [x] **Step 5: Commit**

Commit message: `feat(mobile): add live assistant controls`

### Task 3: Terminal, preview and files

**Files:**

- Create: `mobile/src/realtime/terminal-session.ts`
- Create: `mobile/src/realtime/terminal-session.test.ts`
- Create: `mobile/src/features/workspace/TerminalScreen.tsx`
- Create: `mobile/src/features/workspace/TerminalScreen.test.tsx`
- Create: `mobile/src/features/workspace/PreviewScreen.tsx`
- Create: `mobile/src/features/workspace/FilesScreen.tsx`
- Create: `mobile/src/features/workspace/FilesScreen.test.tsx`
- Create: `mobile/app/session/[threadId]/terminal.tsx`
- Create: `mobile/app/session/[threadId]/preview.tsx`
- Create: `mobile/app/session/[threadId]/files.tsx`
- Modify: `mobile/src/api/contracts.ts`
- Modify: `mobile/src/api/client.ts`
- Modify: `mobile/src/api/client.test.ts`

- [x] **Step 1: Write failing transport tests**

Prove the terminal joins `terminal:thread:<id>`, renders snapshots and deltas,
sends input and resize events, reconnects without duplicating output, and
disconnects on unmount. Prove document listing and file reads remain scoped to
the selected thread.

- [x] **Step 2: Run tests and verify RED**

Run:
`cd mobile && npm run test:unit -- src/realtime/terminal-session.test.ts src/api/client.test.ts`

Expected: FAIL because terminal and document transports are absent.

- [x] **Step 3: Implement terminal and document transports**

Keep ANSI output as selectable monospace text in the first native slice.
Reject parent traversal before requests and rely on the backend sandbox as the
authoritative boundary.

- [ ] **Step 4: Build focused workspace screens**

Terminal has reconnect and keyboard controls. Preview opens the primary ready
dev-server URL with explicit unavailable/offline states. Files provide search,
tree/list, source text, Markdown text and authenticated image preview.

- [x] **Step 5: Verify**

Run:
`cd mobile && npm run test:unit -- src/realtime/terminal-session.test.ts src/api/client.test.ts && npm run test:ui -- src/features/workspace && npm run typecheck`

Expected: PASS.

- [x] **Step 6: Commit**

Commit message: `feat(mobile): add terminal preview and files`

### Task 4: Diff and source control

**Files:**

- Create: `mobile/src/features/source-control/diff-state.ts`
- Create: `mobile/src/features/source-control/diff-state.test.ts`
- Create: `mobile/src/features/source-control/DiffScreen.tsx`
- Create: `mobile/src/features/source-control/DiffScreen.test.tsx`
- Create: `mobile/src/features/source-control/CommitSheet.tsx`
- Create: `mobile/app/session/[threadId]/diff.tsx`
- Modify: `mobile/src/api/contracts.ts`
- Modify: `mobile/src/api/client.ts`
- Modify: `mobile/src/api/client.test.ts`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/workspace_diff_controller.ex`

- [x] **Step 1: Write failing diff API tests**

Prove stats, paginated file metadata and one-file patches are loaded separately.
Prove commit/push mutations require explicit messages and surface structured
server failures.

- [x] **Step 2: Run tests and verify RED**

Run: `cd mobile && npm run test:unit -- src/api/client.test.ts src/features/source-control`

Expected: FAIL because diff contracts are absent.

- [x] **Step 3: Add thread-scoped push when absent and implement client**

Add the thread push route with the same workspace resolution and sandbox rules
as thread commit. Implement stats/files/patch/commit/push methods in the mobile
client.

- [x] **Step 4: Implement diff and commit/push UI**

Render per-repository stats, lazy file patches and semantic add/delete colors.
Require confirmation before commit or push and refresh stats after success.

- [ ] **Step 5: Verify**

Run:
`mix test elixir/test/symphony_elixir_web/controllers/tracker/workspace_diff_controller_test.exs && cd mobile && npm run test:unit -- src/api/client.test.ts src/features/source-control && npm run test:ui -- src/features/source-control && npm run typecheck`

Expected: PASS.

- [x] **Step 6: Commit**

Commit message: `feat(mobile): add diff commit and push`

### Task 5: Pull-request operations

**Files:**

- Create: `mobile/src/features/pull-requests/PullRequestScreen.tsx`
- Create: `mobile/src/features/pull-requests/PullRequestScreen.test.tsx`
- Create: `mobile/app/issue/[projectSlug]/[identifier]/pull-request.tsx`
- Modify: `mobile/src/api/contracts.ts`
- Modify: `mobile/src/api/client.ts`
- Modify: `mobile/src/api/client.test.ts`

- [x] **Step 1: Write failing API and screen tests**

Cover list/link/unlink, checks, update branch, rerun failed, fix and merge.
Destructive actions require confirmation; merge displays conflicts and blocked
checks without discarding loaded PR state.

- [x] **Step 2: Run tests and verify RED**

Run:
`cd mobile && npm run test:unit -- src/api/client.test.ts && npm run test:ui -- src/features/pull-requests`

Expected: FAIL because PR methods and screen are absent.

- [x] **Step 3: Implement API and screen**

Map the existing tracker PR presentation into a mobile contract and invalidate
the issue PR query after each successful action.

- [x] **Step 4: Verify**

Run:
`cd mobile && npm run test:unit -- src/api/client.test.ts && npm run test:ui -- src/features/pull-requests && npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit**

Commit message: `feat(mobile): add pull request operations`

### Task 6: Native notifications, deep links and dictation

**Files:**

- Modify: `mobile/package.json`
- Modify: `mobile/app.config.ts`
- Create: `mobile/src/native/notifications.ts`
- Create: `mobile/src/native/notifications.test.ts`
- Create: `mobile/src/native/dictation.ts`
- Create: `mobile/src/features/notifications/NotificationsScreen.tsx`
- Create: `mobile/app/notifications.tsx`
- Modify: `mobile/src/features/sessions/NewSessionScreen.tsx`
- Modify: `mobile/src/features/sessions/SessionScreen.tsx`
- Modify: `elixir/lib/symphony_elixir_web/router.ex`
- Create: `elixir/lib/symphony_elixir_web/controllers/tracker/mobile_push_controller.ex`
- Create: `elixir/test/symphony_elixir_web/controllers/tracker/mobile_push_controller_test.exs`

- [x] **Step 1: Install compatible Expo native libraries**

Run:
`cd mobile && npx expo install expo-notifications expo-device expo-speech-recognition`

Expected: Expo SDK-compatible versions added without peer conflicts.

- [x] **Step 2: Write failing registration and routing tests**

Prove tokens register per profile/device, unregister on profile removal, and
notification payloads deep-link only to allowed issue/session routes. Prove
dictation appends transcript without replacing an existing draft.

- [x] **Step 3: Implement backend Expo-token contract and native adapters**

Store native subscriptions separately from Web Push subscriptions. Never log
tokens. Route issue/session payloads through Expo Router and expose permission
denial as a recoverable settings state.

- [x] **Step 4: Add notification screen and voice controls**

Add accessible voice controls to both composers and a notifications route with
permission, registration, test-notification and deep-link state.

- [ ] **Step 5: Verify**

Run:
`mix test elixir/test/symphony_elixir_web/controllers/tracker/mobile_push_controller_test.exs && cd mobile && npm test && npm run typecheck && npm run doctor`

Expected: PASS.

WSL safety note: focused mobile unit/UI tests, typecheck, lint and formatting
passed. The focused Elixir controller test and Expo Doctor remain deferred to
CI or a dedicated native runner so this workstation is not overloaded.

- [x] **Step 6: Commit**

Commit message: `feat(mobile): add notifications and dictation`

### Task 7: Connection management, usage, diagnostics and offline recovery

**Files:**

- Create: `mobile/src/diagnostics/diagnostic-log.ts`
- Create: `mobile/src/diagnostics/diagnostic-log.test.ts`
- Create: `mobile/src/features/connections/ConnectionsScreen.tsx`
- Create: `mobile/src/features/connections/ConnectionsScreen.test.tsx`
- Create: `mobile/src/features/diagnostics/DiagnosticsScreen.tsx`
- Create: `mobile/src/features/settings/SettingsScreen.tsx`
- Create: `mobile/app/connections.tsx`
- Create: `mobile/app/diagnostics.tsx`
- Create: `mobile/app/settings.tsx`
- Modify: `mobile/src/api/QueryProvider.tsx`
- Modify: `mobile/src/api/client.ts`
- Modify: `mobile/src/api/contracts.ts`
- Modify: `mobile/src/auth/ConnectionProvider.tsx`

- [x] **Step 1: Write failing diagnostics and connection tests**

Prove every URL/header/body diagnostic is redacted, log storage is bounded,
profile switching rebuilds the active client, token replacement validates
before persisting, and profile removal deletes its token and cached queries.

- [x] **Step 2: Run tests and verify RED**

Run:
`cd mobile && npm run test:unit -- src/diagnostics src/auth && npm run test:ui -- src/features/connections`

Expected: FAIL because diagnostics and profile management are absent.

- [x] **Step 3: Implement bounded diagnostics and profile management**

Record request/socket state without secrets. Add explicit reconnect, replace
token, switch profile and remove profile actions. Persist React Query read
models per safe profile id and show stale/offline timestamps.

- [x] **Step 4: Implement usage and settings**

Load `/settings/agents/usage`, show agent windows and availability, theme,
notification and diagnostics entries. Unsupported capabilities show an
explanation rather than a dead control.

- [x] **Step 5: Verify**

Run:
`cd mobile && npm run test:unit -- src/diagnostics src/auth src/api && npm run test:ui -- src/features/connections src/features/diagnostics src/features/settings && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(mobile): add connection diagnostics and settings`

### Task 8: Cross-platform parity hardening and complete E2E evidence

**Files:**

- Modify: `mobile/e2e/android-smoke.sh`
- Create: `mobile/e2e/ios-smoke.sh`
- Modify: `mobile/src/e2e/fixture-runtime.ts`
- Modify: `mobile/src/e2e/fixture-runtime.test.ts`
- Modify: `docs/superpowers/plans/2026-07-24-orca-parity-completion-plan.md`

- [ ] **Step 1: Extend deterministic fixture boundaries**

Fixture only storage, REST and channel/native-service boundaries. Real Expo
Router screens must cover connection, tasks, issue edit/comment/dispatch,
session approval/question, terminal, preview, files, diff, commit/push, PR,
notifications, voice affordance, profile switch and diagnostics.

- [ ] **Step 2: Run full quality gate**

Run:
`cd mobile && npm test && npm run typecheck && npm run lint && npm run format:check && npm run doctor && npm run build:android:e2e`

Expected: PASS with no warnings introduced by changed files.

- [ ] **Step 3: Run Android and iOS E2E**

Run Android: `cd mobile && npm run test:e2e:android`

Run iOS: `cd mobile && bash e2e/ios-smoke.sh`

Expected: both flows pass and produce continuous videos plus trace reports.

- [ ] **Step 4: Accessibility and visual audit**

Verify 44-point targets, text/icon status redundancy, Dynamic Type, logical
screen-reader order and reduced-motion behavior on the complete route set.

- [ ] **Step 5: Refresh external evidence**

Upload the complete E2E video and metadata to the existing gist, update PR #7
with the direct raw video URL and exact validation commands, and remove stale
demo references from the PR description.

- [ ] **Step 6: Requirement-by-requirement completion audit**

For all twelve acceptance criteria in the design spec, record the exact test,
runtime artifact, route or API response that proves it. Any missing or indirect
evidence keeps this plan incomplete.

- [ ] **Step 7: Commit and push**

Commit message: `test(mobile): prove complete Orca-inspired experience`
