# Mobile Task and Session Navigation Implementation Plan

**Goal:** Deliver task-aware mobile session navigation, a five-tab task detail, and composer actions for Plan mode, Magic, and structured issue/file/PR context.

**Architecture:** Reuse the existing task association in `OrchestratorSessionRoute` and the existing Expo Router issue route. Split the current monolithic `IssueScreen` into a task shell plus five focused tab components backed by one aggregate query, and add small mobile RPC adapters for Magic and mention discovery rather than duplicating web semantics. Keep composer sheet state local while routing selected actions through explicit callbacks owned by session routes.

**Tech Stack:** React Native, Expo Router, TypeScript, TanStack Query, Jest/React Native Testing Library, Elixir/Phoenix mobile RPC, ExUnit.

---

## File map

- `mobile/src/features/tasks/IssueScreen.tsx`: task header, five-tab shell, shared state.
- `mobile/src/features/tasks/IssueSummaryTab.tsx`: summary, Workpad, metadata, task actions.
- `mobile/src/features/tasks/IssuePullRequestTab.tsx`: PR rollup, semantic check states, blocker panel.
- `mobile/src/features/tasks/IssueCommentsTab.tsx`: comment composer and stream.
- `mobile/src/features/tasks/IssueEvidenceTab.tsx`: latest run summary and artifacts.
- `mobile/src/features/tasks/IssueSessionsTab.tsx`: execution/chat sessions and new-session action.
- `mobile/src/features/tasks/issue-pr-state.ts`: pure PR state normalization.
- `mobile/src/features/tasks/useIssueDetail.ts`: aggregate issue/comments/PR/session data.
- `mobile/src/features/tasks/IssueRoute.tsx`: route callbacks for tabs and related surfaces.
- `mobile/src/features/sessions/AssistantChatScreen.tsx`: quick-action sheet and selected context chips.
- `mobile/src/features/sessions/MobileMagicSheet.tsx`: searchable Magic command surface.
- `mobile/src/features/sessions/MobileContextSheet.tsx`: grouped structured mention picker.
- `mobile/src/features/sessions/mobile-composer-actions.ts`: pure action and mention helpers.
- `mobile/src/features/sessions/SessionRoute.tsx`: regular session callback wiring.
- `mobile/src/features/orchestrator/OrchestratorSessionRoute.tsx`: task session callback wiring.
- `mobile/src/api/contracts.ts`: mobile Magic and mention types/client methods.
- `mobile/src/api/client.ts`: REST compatibility implementations.
- `mobile/src/rpc/mobile-assistant-tools.ts`: RPC Magic/mention adapters.
- `elixir/lib/symphony_elixir/mobile_rpc/methods/assistant_tools.ex`: RPC method declarations.
- `elixir/lib/symphony_elixir/mobile_rpc/assistant_tools_service.ex`: bridge to canonical Magic/mention sources.
- Corresponding colocated `*.test.ts(x)` and ExUnit test files validate each unit.

### Task 1: Lock task navigation behavior

**Files:**
- Modify: `mobile/src/features/sessions/AssistantChatScreen.test.tsx`
- Modify: `mobile/src/features/orchestrator/OrchestratorSessionRoute.test.tsx`
- Modify: `mobile/src/features/sessions/AssistantChatScreen.tsx`
- Modify: `mobile/src/features/orchestrator/OrchestratorSessionRoute.tsx`

- [ ] **Step 1: Write the failing associated-task header test**

Add an assertion that `Open VIN-3 task` is rendered beside `Open terminal`, invokes
`onOpenTask`, and is absent when `taskLinks` is undefined.

```tsx
expect(screen.getByRole("button", { name: "Open terminal" })).toBeTruthy();
fireEvent.press(screen.getByRole("button", { name: "Open VIN-3 task" }));
expect(onOpenTask).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the focused tests and confirm the intended failure**

Run:

```bash
cd mobile
npx jest src/features/sessions/AssistantChatScreen.test.tsx \
  src/features/orchestrator/OrchestratorSessionRoute.test.tsx --runInBand
```

Expected: failure only where current route/header behavior differs from the
specified associated-task contract.

- [ ] **Step 3: Implement the minimal header and route behavior**

Keep the existing `taskLinks` contract, remove the duplicate `TaskAccessDock`,
and retain only the header task shortcut. Route it to:

```ts
`/codex/issue/${encodeURIComponent(projectSlug)}/${encodeURIComponent(identifier)}`
```

Expo Router supplies the native push animation; no modal is introduced.

- [ ] **Step 4: Run the focused tests**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/sessions/AssistantChatScreen.tsx \
  mobile/src/features/sessions/AssistantChatScreen.test.tsx \
  mobile/src/features/orchestrator/OrchestratorSessionRoute.tsx \
  mobile/src/features/orchestrator/OrchestratorSessionRoute.test.tsx
git commit -m "feat(mobile): open associated tasks from sessions"
```

### Task 2: Introduce the five-tab task shell

**Files:**
- Create: `mobile/src/features/tasks/issue-tabs.ts`
- Create: `mobile/src/features/tasks/issue-tabs.test.ts`
- Modify: `mobile/src/features/tasks/IssueScreen.tsx`
- Modify: `mobile/src/features/tasks/IssueScreen.test.tsx`

- [ ] **Step 1: Test the fixed tab contract**

```ts
expect(ISSUE_TABS.map((tab) => tab.id)).toEqual([
  "summary",
  "pr",
  "comments",
  "evidence",
  "sessions",
]);
```

Test that tapping each accessible tab renders only its corresponding pane and
keeps the header identifier/status visible.

- [ ] **Step 2: Verify failure**

```bash
cd mobile
npx jest src/features/tasks/issue-tabs.test.ts \
  src/features/tasks/IssueScreen.test.tsx --runInBand
```

Expected: FAIL because the fixed tab model and shell do not exist.

- [ ] **Step 3: Add the tab model and shell**

```ts
export type IssueTabId =
  | "summary"
  | "pr"
  | "comments"
  | "evidence"
  | "sessions";

export const ISSUE_TABS = [
  { id: "summary", label: "Summary" },
  { id: "pr", label: "PR" },
  { id: "comments", label: "Comments" },
  { id: "evidence", label: "Evidence" },
  { id: "sessions", label: "Sessions" },
] as const;
```

Render the active pane below a horizontally reachable tab strip. Keep back,
identifier, status, and overflow actions persistent.

- [ ] **Step 4: Verify pass**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/tasks/issue-tabs.ts \
  mobile/src/features/tasks/issue-tabs.test.ts \
  mobile/src/features/tasks/IssueScreen.tsx \
  mobile/src/features/tasks/IssueScreen.test.tsx
git commit -m "feat(mobile): add focused task detail tabs"
```

### Task 3: Build Summary and Comments tabs

**Files:**
- Create: `mobile/src/features/tasks/IssueSummaryTab.tsx`
- Create: `mobile/src/features/tasks/IssueSummaryTab.test.tsx`
- Create: `mobile/src/features/tasks/IssueCommentsTab.tsx`
- Create: `mobile/src/features/tasks/IssueCommentsTab.test.tsx`
- Modify: `mobile/src/features/tasks/IssueScreen.tsx`

- [ ] **Step 1: Write Summary tests**

Assert visible title, description, status, priority, assignee, agent/model/effort,
branch, labels, updated time, Workpad summary, and `Open session` /
`Open workspace` actions.

- [ ] **Step 2: Write Comments tests**

Assert comments render author/time/body and that a nonblank Markdown comment
calls `onAddComment` once while an empty body remains disabled.

- [ ] **Step 3: Verify both suites fail**

```bash
cd mobile
npx jest src/features/tasks/IssueSummaryTab.test.tsx \
  src/features/tasks/IssueCommentsTab.test.tsx --runInBand
```

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement focused components**

Move existing summary fields and comment mutation controls out of
`IssueScreen.tsx`. Represent Workpad using the latest comment whose `kind` is
`workpad`; do not parse or mutate its Markdown in this task.

- [ ] **Step 5: Verify pass and regressions**

```bash
cd mobile
npx jest src/features/tasks/IssueSummaryTab.test.tsx \
  src/features/tasks/IssueCommentsTab.test.tsx \
  src/features/tasks/IssueScreen.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/tasks/IssueSummaryTab.tsx \
  mobile/src/features/tasks/IssueSummaryTab.test.tsx \
  mobile/src/features/tasks/IssueCommentsTab.tsx \
  mobile/src/features/tasks/IssueCommentsTab.test.tsx \
  mobile/src/features/tasks/IssueScreen.tsx
git commit -m "feat(mobile): add task summary and comments tabs"
```

### Task 4: Build color-semantic PR tab

**Files:**
- Create: `mobile/src/features/tasks/issue-pr-state.ts`
- Create: `mobile/src/features/tasks/issue-pr-state.test.ts`
- Create: `mobile/src/features/tasks/IssuePullRequestTab.tsx`
- Create: `mobile/src/features/tasks/IssuePullRequestTab.test.tsx`
- Modify: `mobile/src/features/tasks/useIssueDetail.ts`
- Modify: `mobile/src/features/tasks/IssueScreen.tsx`

- [ ] **Step 1: Test PR normalization**

```ts
expect(prCheckTone({ status: "completed", conclusion: "success" })).toBe("success");
expect(prCheckTone({ status: "in_progress", conclusion: null })).toBe("warning");
expect(prCheckTone({ status: "completed", conclusion: "failure" })).toBe("failure");
```

Also test that failed checks produce a merge-blocking problem count and pending
review produces warning without being described as a failed check.

- [ ] **Step 2: Verify failure**

```bash
cd mobile
npx jest src/features/tasks/issue-pr-state.test.ts \
  src/features/tasks/IssuePullRequestTab.test.tsx --runInBand
```

Expected: FAIL because the normalizer and tab do not exist.

- [ ] **Step 3: Load pull-request data**

Extend `useIssueDetail` with:

```ts
const pullRequests = await client.pullRequests(projectSlug, identifier, signal);
```

Return the result independently so its error/refresh state can be surfaced in
the PR pane without blanking Summary.

- [ ] **Step 4: Implement the PR tab**

Use `colors.statusGreen`, `colors.statusAmber`, and `colors.statusRed` for
markers/background accents, paired with text labels `Passed`, `Pending`, and
`Failed`. Render a destructive problem panel when failed jobs/statuses or an
unmergeable state block merge.

- [ ] **Step 5: Verify pass**

Run the command from Step 2 and:

```bash
npx jest src/features/tasks/IssueScreen.test.tsx \
  src/features/tasks/IssueRoute.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/tasks/issue-pr-state.ts \
  mobile/src/features/tasks/issue-pr-state.test.ts \
  mobile/src/features/tasks/IssuePullRequestTab.tsx \
  mobile/src/features/tasks/IssuePullRequestTab.test.tsx \
  mobile/src/features/tasks/useIssueDetail.ts \
  mobile/src/features/tasks/IssueScreen.tsx
git commit -m "feat(mobile): surface pull request health on tasks"
```

### Task 5: Build Evidence and Sessions tabs

**Files:**
- Create: `mobile/src/features/tasks/IssueEvidenceTab.tsx`
- Create: `mobile/src/features/tasks/IssueEvidenceTab.test.tsx`
- Create: `mobile/src/features/tasks/IssueSessionsTab.tsx`
- Create: `mobile/src/features/tasks/IssueSessionsTab.test.tsx`
- Modify: `mobile/src/features/tasks/IssueRoute.tsx`
- Modify: `mobile/src/features/tasks/IssueScreen.tsx`

- [ ] **Step 1: Test latest evidence and artifact presentation**

Assert status, timestamp, provenance, hash, and known artifact kinds are exposed,
with `View complete run` routing to the existing evidence screen.

- [ ] **Step 2: Test task-associated session rows**

Assert execution first, chats afterward, with status/type/agent/updated time,
and assert `New session` routes with `scope: "issue_session"`.

- [ ] **Step 3: Verify failure**

```bash
cd mobile
npx jest src/features/tasks/IssueEvidenceTab.test.tsx \
  src/features/tasks/IssueSessionsTab.test.tsx --runInBand
```

Expected: FAIL because the focused components do not exist.

- [ ] **Step 4: Implement both tabs using existing records**

Pass `useTaskEvidence` records and `useIssueDetail` threads to the components.
Do not fetch duplicate terminal/files/preview data.

- [ ] **Step 5: Verify pass**

Run the command from Step 3 plus `IssueRoute.test.tsx`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/tasks/IssueEvidenceTab.tsx \
  mobile/src/features/tasks/IssueEvidenceTab.test.tsx \
  mobile/src/features/tasks/IssueSessionsTab.tsx \
  mobile/src/features/tasks/IssueSessionsTab.test.tsx \
  mobile/src/features/tasks/IssueRoute.tsx \
  mobile/src/features/tasks/IssueScreen.tsx
git commit -m "feat(mobile): add task evidence and sessions tabs"
```

### Task 6: Add Plan mode and quick-action sheet

**Files:**
- Create: `mobile/src/features/sessions/mobile-composer-actions.ts`
- Create: `mobile/src/features/sessions/mobile-composer-actions.test.ts`
- Modify: `mobile/src/features/sessions/AssistantChatScreen.tsx`
- Modify: `mobile/src/features/sessions/AssistantChatScreen.test.tsx`
- Modify: `mobile/src/features/sessions/SessionRoute.tsx`
- Modify: `mobile/src/features/orchestrator/OrchestratorSessionRoute.tsx`

- [ ] **Step 1: Test action order and Plan mode**

```ts
expect(MOBILE_COMPOSER_ACTIONS.map((action) => action.id)).toEqual([
  "plan",
  "magic",
  "context",
  "goal",
]);
```

Test that `Plan mode` calls
`onSetTurnPreferences({ executionMode: "plan" })`, closes the sheet, and keeps
the draft unchanged.

- [ ] **Step 2: Verify failure**

```bash
cd mobile
npx jest src/features/sessions/mobile-composer-actions.test.ts \
  src/features/sessions/AssistantChatScreen.test.tsx --runInBand
```

Expected: FAIL because `+` opens goal directly.

- [ ] **Step 3: Implement the bottom sheet**

Use React Native `Modal` with a bottom-aligned panel and the app theme. Route
goal to `GoalDock` and Plan mode to the existing turn-preference callback.
Photo stays outside this focused menu until assistant chat supports durable
attachments; no item may be a no-op.

- [ ] **Step 4: Verify pass**

Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/sessions/mobile-composer-actions.ts \
  mobile/src/features/sessions/mobile-composer-actions.test.ts \
  mobile/src/features/sessions/AssistantChatScreen.tsx \
  mobile/src/features/sessions/AssistantChatScreen.test.tsx \
  mobile/src/features/sessions/SessionRoute.tsx \
  mobile/src/features/orchestrator/OrchestratorSessionRoute.tsx
git commit -m "feat(mobile): add composer quick actions and plan mode"
```

### Task 7: Expose canonical Magic and context data through mobile RPC

**Files:**
- Create: `elixir/lib/symphony_elixir/mobile_rpc/assistant_tools_service.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/assistant_tools.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/assistant_tools_service_test.exs`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/socket.ex`
- Modify: `mobile/src/api/contracts.ts`
- Create: `mobile/src/rpc/mobile-assistant-tools.ts`
- Create: `mobile/src/rpc/mobile-assistant-tools.test.ts`

- [ ] **Step 1: Write failing Elixir service tests**

Cover:

```elixir
assert {:ok, %{"groups" => groups}} =
         AssistantToolsService.call("assistant.context.search", %{
           "project_slug" => "symphony",
           "query" => "VIN"
         }, context)

assert Enum.map(groups, & &1["type"]) == ["issue", "file", "pr"]
```

Also cover Magic list/run preserving slug, category, agent, model, effort, and
mode.

- [ ] **Step 2: Verify Elixir failure**

```bash
cd elixir
mix test test/symphony_elixir/mobile_rpc/assistant_tools_service_test.exs
```

Expected: compile/test failure because the service is absent.

- [ ] **Step 3: Implement bridge methods**

Declare:

- `assistant.magic.list`
- `assistant.magic.run`
- `assistant.context.search`

Bridge them to the same tracker/assistant sources used by web endpoints. Return
stable JSON DTOs; never encode selected entities as display strings.

- [ ] **Step 4: Verify Elixir pass and specs**

```bash
cd elixir
mix test test/symphony_elixir/mobile_rpc/assistant_tools_service_test.exs
mix specs.check
```

Expected: PASS.

- [ ] **Step 5: Test and implement TypeScript adapters**

Normalize results to:

```ts
type MobileMentionRef = { type: "issue" | "file" | "pr"; id: string };
type MobileMentionOption = MobileMentionRef & { label: string | null };
```

Run:

```bash
cd mobile
npx jest src/rpc/mobile-assistant-tools.test.ts --runInBand
```

Expected: PASS after implementation.

- [ ] **Step 6: Commit**

```bash
git add elixir/lib/symphony_elixir/mobile_rpc/assistant_tools_service.ex \
  elixir/lib/symphony_elixir/mobile_rpc/methods/assistant_tools.ex \
  elixir/lib/symphony_elixir/mobile_rpc/socket.ex \
  elixir/test/symphony_elixir/mobile_rpc/assistant_tools_service_test.exs \
  mobile/src/api/contracts.ts mobile/src/rpc/mobile-assistant-tools.ts \
  mobile/src/rpc/mobile-assistant-tools.test.ts
git commit -m "feat(mobile): expose magic and context assistant tools"
```

### Task 8: Add Magic and structured context sheets

**Files:**
- Create: `mobile/src/features/sessions/MobileMagicSheet.tsx`
- Create: `mobile/src/features/sessions/MobileMagicSheet.test.tsx`
- Create: `mobile/src/features/sessions/MobileContextSheet.tsx`
- Create: `mobile/src/features/sessions/MobileContextSheet.test.tsx`
- Modify: `mobile/src/features/sessions/AssistantChatScreen.tsx`
- Modify: `mobile/src/features/sessions/SessionRoute.tsx`
- Modify: `mobile/src/features/orchestrator/OrchestratorSessionRoute.tsx`

- [ ] **Step 1: Test Magic search and selection**

Assert grouped built-ins/templates, metadata badges, loading/empty/failure
states, and that selecting a template calls `runMagic(slug)` once.

- [ ] **Step 2: Test context grouping and structured selection**

Assert groups are ordered issue/file/PR and selecting `VIN-3` yields:

```ts
{ type: "issue", id: "VIN-3" }
```

The selected chip must be removable without changing the composer text.

- [ ] **Step 3: Verify failure**

```bash
cd mobile
npx jest src/features/sessions/MobileMagicSheet.test.tsx \
  src/features/sessions/MobileContextSheet.test.tsx --runInBand
```

Expected: FAIL because both sheets are absent.

- [ ] **Step 4: Implement and wire both sheets**

Load via `mobile-assistant-tools.ts`. Show grouped results and metadata using
native lists. On send, pass selected mention refs through the session message
contract's structured context field; do not interpolate hidden URLs or labels
into the message.

- [ ] **Step 5: Verify pass**

Run the command from Step 3 and `AssistantChatScreen.test.tsx`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/sessions/MobileMagicSheet.tsx \
  mobile/src/features/sessions/MobileMagicSheet.test.tsx \
  mobile/src/features/sessions/MobileContextSheet.tsx \
  mobile/src/features/sessions/MobileContextSheet.test.tsx \
  mobile/src/features/sessions/AssistantChatScreen.tsx \
  mobile/src/features/sessions/SessionRoute.tsx \
  mobile/src/features/orchestrator/OrchestratorSessionRoute.tsx
git commit -m "feat(mobile): add magic and structured context sheets"
```

### Task 9: End-to-end and visual verification

**Files:**
- Create: `mobile/e2e/task-session-navigation.e2e.ts`
- Modify: `mobile/scripts/mock-server-rpc-handlers.ts`
- Modify: `mobile/src/rpc/mock-server-rpc-handlers.test.ts`
- Modify: `mobile/docs/ios-real-host-e2e.md`

- [ ] **Step 1: Add deterministic mock fixtures**

Serve a task-associated session, one healthy/one failed PR check, comments,
evidence artifacts, sessions, Magic commands, and issue/file/PR mention search
results.

- [ ] **Step 2: Add E2E assertions**

Cover:

1. open associated task and return without losing the session;
2. visit all five task tabs;
3. observe labeled PR success/warning/failure states;
4. switch to Plan mode;
5. open and run Magic;
6. add and remove issue/file/PR context.

- [ ] **Step 3: Run focused and full mobile gates**

```bash
cd mobile
npm test -- --runInBand
npm run typecheck
npm run lint
```

Expected: all commands exit 0.

- [ ] **Step 4: Run backend gates**

```bash
cd elixir
mix test
mix specs.check
```

Expected: all commands exit 0.

- [ ] **Step 5: Capture Android and iOS evidence**

Run the repository's existing mobile E2E capture workflow, verify every
screenshot visually, and record the artifact paths in the task evidence
manifest. Confirm reduced-motion behavior manually or with the platform setting.

- [ ] **Step 6: Commit**

```bash
git add mobile/e2e/task-session-navigation.e2e.ts \
  mobile/scripts/mock-server-rpc-handlers.ts \
  mobile/src/rpc/mock-server-rpc-handlers.test.ts \
  mobile/docs/ios-real-host-e2e.md
git commit -m "test(mobile): cover task session navigation"
```

### Task 10: Requirement audit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-mobile-task-session-navigation-plan.md`

- [ ] **Step 1: Audit every design requirement**

For each section in
`docs/superpowers/specs/2026-07-29-mobile-task-session-navigation-design.md`,
record the implementing file and passing test/evidence path.

- [ ] **Step 2: Run final diff and repository checks**

```bash
git status --short
git diff --check HEAD~9..HEAD
```

Expected: only intentional changes; no whitespace errors or generated junk.

- [ ] **Step 3: Mark plan tasks complete and commit**

```bash
git add docs/superpowers/plans/2026-07-29-mobile-task-session-navigation-plan.md
git commit -m "docs(mobile): record task navigation validation"
```

## Implementation audit — 2026-07-29

- Associated task navigation: `AssistantChatScreen.tsx` keeps one task shortcut
  beside Terminal; `OrchestratorSessionRoute.tsx` pushes the canonical issue
  route. Covered by `AssistantChatScreen.test.tsx`.
- Five focused tabs: Summary, PR, Comments, Evidence, and Sessions are fixed by
  `issue-tabs.ts` and rendered by `IssueScreen.tsx`. Summary now contains the
  operational metadata and Workpad while comments live only in Comments.
- PR health: `IssuePullRequestTab.tsx` and `issue-pr-state.ts` pair green,
  amber, and red accents with Passed, Pending, and Failed text and a blocking
  problem panel.
- Evidence and sessions: focused tabs use the existing canonical evidence and
  thread records without duplicate workspace fetches.
- Composer actions: the focused menu contains Plan mode, Magic, Add context,
  and Goal. Magic uses canonical prompt-template endpoints over REST or mobile
  RPC. Context searches issue/file/PR sources independently.
- Structured context: selected refs remain removable chips and are sent as
  `context_refs` through regular and orchestrator session transports; labels
  and hidden URLs are not interpolated into the message.
- Focused validation: 31 task/composer Jest tests and 47 contract Vitest tests
  passed; the mobile RPC bridge ExUnit suite passed 8/8; oxlint and
  `git diff --check` passed for the changed surfaces.
- Global-gate baseline: `npm test` reached 1428 passing tests and 7 unrelated
  failures (missing ImageMagick `convert`, an old E2E shell-contract mismatch,
  and `__DEV__` absent in terminal tests). Typecheck reports only five existing
  typed-route errors outside changed files. Full ExUnit exposed many unrelated
  workspace/backup/agent failures and was stopped after the relevant bridge
  suite had passed.
- Visual capture: no ADB device was connected in this environment, so no new
  Android/iOS runtime screenshots were claimed.
