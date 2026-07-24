# Codex-Style Mobile Sessions Implementation Plan

**Goal:** Replace the placeholder mobile route with a connection-aware, Codex-style session library and composer-first session creation flow backed by Symphony's existing tracker APIs.

**Architecture:** A small injected `TrackerClient` owns authenticated REST calls and maps wire DTOs into mobile-only contracts. Pure session-tree and composer-state modules isolate grouping, filtering, defaults, and payload construction from React Native. Expo Router screens compose those modules, while React Query owns remote state and the existing connection provider owns credentials.

**Tech Stack:** Expo SDK 55, React Native 0.83, Expo Router, TanStack Query, Zod, Vitest, Jest, React Native Testing Library, Phoenix Channels.

---

## Scope

This plan delivers the first complete session-oriented mobile path:

1. connect to a Symphony tracker;
2. view/search sessions grouped by project;
3. open a focused new-chat composer;
4. create freeform, project, workspace, or issue sessions;
5. navigate to the created session and submit its initial prompt;
6. preserve context and drafts across recoverable failures.

Tasks, workspace tools, attachments, voice input, push notifications, and full
approval/question cards remain in their later delivery slices. Their controls
must not appear as non-functional affordances in this slice.

## File Map

- `mobile/src/api/contracts.ts` — mobile-only project, thread, session, catalog,
  and viewer types.
- `mobile/src/api/errors.ts` — typed, redacted tracker failures.
- `mobile/src/api/client.ts` — authenticated REST transport and DTO mapping.
- `mobile/src/api/TrackerClientProvider.tsx` — active-profile-bound client.
- `mobile/src/features/connect/ConnectScreen.tsx` — secure connection setup.
- `mobile/src/features/sessions/session-tree.ts` — deduplication, grouping,
  ordering, and search.
- `mobile/src/features/sessions/SessionLibraryScreen.tsx` — project-grouped root
  screen with fixed Search/Chat dock.
- `mobile/src/features/sessions/new-session-state.ts` — progressive context
  state and create payload construction.
- `mobile/src/features/sessions/NewSessionScreen.tsx` — full-screen
  composer-first creation.
- `mobile/src/realtime/assistant-session.ts` — minimal Phoenix channel adapter
  for seed submission and history.
- `mobile/src/features/sessions/SessionScreen.tsx` — initial read/compose chat.
- `mobile/app/*` — connection-aware Expo Router entry points.

### Task 1: Add the authenticated tracker client

**Files:**

- Create: `mobile/src/api/contracts.ts`
- Create: `mobile/src/api/errors.ts`
- Create: `mobile/src/api/client.ts`
- Create: `mobile/src/api/client.test.ts`
- Create: `mobile/src/api/TrackerClientProvider.tsx`
- Modify: `mobile/app/_layout.tsx`

- [x] **Step 1: Write the failing transport tests**

Cover authenticated URLs, envelope unwrapping, query encoding, redacted 401
errors, protocol errors, and abort/timeout behavior:

```ts
it("binds tracker auth and locale to requests", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    response({ data: { id: "viewer-1", name: "Raphael" } }),
  );
  const client = createTrackerClient({
    origin: "https://demo.test",
    token: "secret",
    locale: "pt-BR",
    fetchImpl,
  });

  await client.viewer();

  expect(fetchImpl).toHaveBeenCalledWith(
    "https://demo.test/api/tracker/v1/viewer",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer secret",
        "X-Symphony-Locale": "pt-BR",
      }),
    }),
  );
});
```

Also assert these public methods and their exact paths:

```ts
client.health(); // GET /api/health
client.projects(); // GET /api/tracker/v1/projects
client.threads({ limit: 100, includeArchived: false });
client.projectSessions("symphony", { limit: 50 });
client.assistantCatalog("symphony");
client.createThread({ scope: "freeform", agentKind: "codex" });
```

- [x] **Step 2: Verify RED**

Run:

```bash
cd mobile && npm run test:unit -- src/api/client.test.ts
```

Expected: FAIL because `createTrackerClient` and the contracts do not exist.

- [x] **Step 3: Implement contracts, errors, and client**

Export these stable app-facing contracts:

```ts
export type AgentKind = "codex" | "claude" | "cursor" | "opencode";

export type ProjectSummary = {
  id: string;
  slug: string;
  name: string;
};

export type AssistantThread = {
  id: number;
  scope: string;
  projectSlug: string | null;
  projectName: string | null;
  issueIdentifier: string | null;
  workspacePath: string | null;
  title: string | null;
  status: string;
  preview: string | null;
  updatedAt: string;
  agentKind: AgentKind | null;
  needsReview: boolean;
};

export type CreateThreadInput =
  | { scope: "freeform"; agentKind: AgentKind; model?: string; effort?: string }
  | {
      scope: "project_session";
      projectSlug: string;
      workspacePath?: string;
      agentKind: AgentKind;
      model?: string;
      effort?: string;
    }
  | {
      scope: "issue_session";
      projectSlug: string;
      issueIdentifier: string;
      workspacePath?: string;
      isolatedWorkspace?: boolean;
      useParentWorkspace?: boolean;
      cloneBranch?: string;
      agentKind: AgentKind;
      model?: string;
      effort?: string;
    };
```

`createTrackerClient` must:

- use `/api/health` only for health and `/api/tracker/v1` for tracker routes;
- encode every path segment with `encodeURIComponent`;
- apply a 30-second timeout linked to an optional caller signal;
- parse only JSON responses for tracker endpoints;
- unwrap `{data: ...}` while preserving paginated `{data, meta}`;
- map snake_case DTOs inside `client.ts`;
- throw `TrackerAuthError`, `TrackerTimeoutError`,
  `TrackerProtocolError`, or `TrackerRequestError`;
- redact the bearer token from all error messages.

- [x] **Step 4: Implement the active-client provider**

`TrackerClientProvider` reads `activeProfile`, `activeToken`, and the device
locale. It exposes `client: TrackerClient | null`; it never persists or logs the
token.

Mount it inside `ConnectionProvider` and above all routes.

- [x] **Step 5: Verify GREEN**

Run:

```bash
cd mobile
npm run test:unit -- src/api/client.test.ts
npm run typecheck
```

Expected: client tests and TypeScript pass.

- [x] **Step 6: Commit**

```bash
git add mobile/src/api mobile/app/_layout.tsx
git commit -m "feat(mobile): add typed tracker client"
```

### Task 2: Add secure connection onboarding and root routing

**Files:**

- Create: `mobile/src/features/connect/ConnectScreen.tsx`
- Create: `mobile/src/features/connect/ConnectScreen.test.tsx`
- Create: `mobile/app/connect.tsx`
- Modify: `mobile/app/index.tsx`

- [x] **Step 1: Write failing screen tests**

Use an injected `validateConnection` and connection context:

```tsx
it("validates health and viewer before saving", async () => {
  render(<ConnectScreen validateConnection={validateConnection} onConnected={onConnected} />);

  fireEvent.changeText(screen.getByLabelText("Connection name"), "Remote");
  fireEvent.changeText(screen.getByLabelText("Tracker URL"), "https://demo.test");
  fireEvent.changeText(screen.getByLabelText("Tracker token"), "secret");
  fireEvent.press(screen.getByRole("button", { name: "Connect" }));

  await waitFor(() =>
    expect(validateConnection).toHaveBeenCalledWith({
      origin: "https://demo.test",
      token: "secret",
    }),
  );
  expect(saveProfile).toHaveBeenCalled();
});
```

Prove blank fields disable Connect, the token uses secure text entry, invalid
auth never renders the token, double submission is ignored, and success calls
`router.replace("/")`.

- [x] **Step 2: Verify RED**

Run:

```bash
cd mobile && npm run test:ui -- src/features/connect/ConnectScreen.test.tsx
```

Expected: FAIL because `ConnectScreen` is missing.

- [x] **Step 3: Implement the screen and redirect**

Use a text-first black surface with:

- backless `Connect to Symphony` heading;
- Connection name, Tracker URL, and secure token inputs;
- one high-contrast Connect button;
- inline status/error text;
- no dashboard or tab bar.

`app/index.tsx` waits for connection hydration. With no active profile it
redirects to `/connect`; with an active profile it renders the session library
delivered in Task 4.

- [x] **Step 4: Verify GREEN**

Run:

```bash
cd mobile
npm run test:ui -- src/features/connect/ConnectScreen.test.tsx
npm run typecheck
```

Expected: onboarding tests and TypeScript pass.

- [x] **Step 5: Commit**

```bash
git add mobile/src/features/connect mobile/app/connect.tsx mobile/app/index.tsx
git commit -m "feat(mobile): add secure connection onboarding"
```

### Task 3: Build the pure session tree

**Files:**

- Create: `mobile/src/features/sessions/session-tree.ts`
- Create: `mobile/src/features/sessions/session-tree.test.ts`

- [x] **Step 1: Write failing grouping tests**

Define the desired API in tests:

```ts
const tree = buildSessionTree({
  projects,
  threads,
  projectSessions,
  query: "",
  collapsedProjectSlugs: new Set(),
  includeArchived: false,
});

expect(tree.map((group) => group.key)).toEqual([
  "project:symphony",
  "project:api",
  "freeform",
]);
expect(tree[0].sessions.map((session) => session.id)).toEqual([
  "thread:needs-review",
  "thread:running",
  "thread:queued",
  "thread:recent",
]);
```

Prove:

- thread and project-session representations of the same thread appear once;
- group order follows project name, with freeform last;
- session order is needs-attention → running → queued → pinned → recent;
- collapsed groups retain counts but expose no rows;
- search is case/diacritic-insensitive across project, title, issue, and preview;
- archived rows are excluded unless requested;
- untitled sessions use issue identifier, preview, then `New session`.

- [x] **Step 2: Verify RED**

Run:

```bash
cd mobile && npm run test:unit -- src/features/sessions/session-tree.test.ts
```

Expected: FAIL because `buildSessionTree` is missing.

- [x] **Step 3: Implement the pure tree**

Export:

```ts
export type SessionTreeGroup = {
  key: string;
  projectSlug: string | null;
  title: string;
  count: number;
  collapsed: boolean;
  sessions: SessionTreeRow[];
};

export function buildSessionTree(input: BuildSessionTreeInput): SessionTreeGroup[];
```

Keep all React, navigation, and network imports out of this file.

- [x] **Step 4: Verify GREEN**

Run:

```bash
cd mobile && npm run test:unit -- src/features/sessions/session-tree.test.ts
```

Expected: all grouping tests pass.

- [x] **Step 5: Commit**

```bash
git add mobile/src/features/sessions/session-tree.ts mobile/src/features/sessions/session-tree.test.ts
git commit -m "feat(mobile): add project session tree"
```

### Task 4: Implement the Codex-style session library

**Files:**

- Create: `mobile/src/features/sessions/SessionLibraryScreen.tsx`
- Create: `mobile/src/features/sessions/SessionLibraryScreen.test.tsx`
- Create: `mobile/src/features/sessions/useSessionLibrary.ts`
- Modify: `mobile/app/index.tsx`

- [x] **Step 1: Write failing screen tests**

Prove the screen renders:

- active connection identity and live/offline text;
- `Projects` heading;
- collapsible project groups and text-first session rows;
- accessible running/attention labels in addition to color;
- fixed `Search chats` and `Chat` controls;
- empty, loading, cached/offline, and retry states;
- navigation to `/session/<threadId>`;
- navigation to `/new-session`;
- filtering without refetching.

```tsx
expect(screen.getByRole("button", { name: "Start a new chat" })).toBeTruthy();
expect(screen.getByPlaceholderText("Search chats")).toBeTruthy();
expect(screen.getByText("symphony")).toBeTruthy();
```

- [x] **Step 2: Verify RED**

Run:

```bash
cd mobile && npm run test:ui -- src/features/sessions/SessionLibraryScreen.test.tsx
```

Expected: FAIL because the screen is missing.

- [x] **Step 3: Implement query composition**

`useSessionLibrary` loads projects and all visible thread scopes in parallel,
then loads up to 50 project-session rows per project. React Query keys include
the active profile id. A profile switch clears only profile-bound queries.

- [x] **Step 4: Implement the screen**

Use `SectionList` or a flattened `FlatList` with:

- 44-point header/menu controls;
- no aggregate cards;
- 16-point side padding and quiet separators;
- bottom safe-area spacer equal to the dock height;
- an absolutely positioned rounded search/chat dock;
- persisted collapsed project slugs in AsyncStorage.

- [x] **Step 5: Verify GREEN**

Run:

```bash
cd mobile
npm run test:ui -- src/features/sessions/SessionLibraryScreen.test.tsx
npm run typecheck
```

Expected: library tests and TypeScript pass.

- [x] **Step 6: Commit**

```bash
git add mobile/src/features/sessions/SessionLibraryScreen.tsx \
  mobile/src/features/sessions/SessionLibraryScreen.test.tsx \
  mobile/src/features/sessions/useSessionLibrary.ts mobile/app/index.tsx
git commit -m "feat(mobile): add Codex-style session library"
```

### Task 5: Implement composer-first session creation

**Files:**

- Create: `mobile/src/features/sessions/new-session-state.ts`
- Create: `mobile/src/features/sessions/new-session-state.test.ts`
- Create: `mobile/src/features/sessions/NewSessionScreen.tsx`
- Create: `mobile/src/features/sessions/NewSessionScreen.test.tsx`
- Create: `mobile/app/new-session.tsx`

- [x] **Step 1: Write failing state tests**

Prove defaults and payloads independently of React Native:

```ts
expect(
  buildCreateThreadInput({
    scope: "project",
    projectSlug: "symphony",
    workspaceMode: "existing",
    workspacePath: "/work/symphony",
    issueIdentifier: null,
    branch: null,
    agentKind: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
  }),
).toEqual({
  scope: "project_session",
  projectSlug: "symphony",
  workspacePath: "/work/symphony",
  agentKind: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
});
```

Also prove freeform ignores project fields, issue-isolated maps
`isolatedWorkspace: true`, parent workspace maps `useParentWorkspace: true`,
blank prompts are rejected, and title derives from the first 160 prompt
characters without requiring input.

- [x] **Step 2: Verify RED**

Run:

```bash
cd mobile && npm run test:unit -- src/features/sessions/new-session-state.test.ts
```

Expected: FAIL because the state module is missing.

- [x] **Step 3: Implement pure state**

Export a reducer with these stable actions:

```ts
type NewSessionAction =
  | { type: "set_prompt"; prompt: string }
  | { type: "set_scope"; scope: "free" | "project" }
  | { type: "set_project"; projectSlug: string | null }
  | { type: "set_workspace"; mode: WorkspaceMode; path?: string | null }
  | { type: "set_issue"; identifier: string | null }
  | { type: "set_branch"; branch: string | null }
  | { type: "set_agent"; agentKind: AgentKind }
  | { type: "set_model"; model: string | null; effort: string | null };
```

Changing scope/project clears invalid dependent selections but preserves the
prompt.

- [x] **Step 4: Write failing screen tests**

Prove:

- prompt is dominant and focused;
- context rows show connection, project, workspace, and branch summaries;
- advanced selectors are collapsed by default;
- the common freeform path needs only text + Send;
- Send is guarded against double taps;
- create failure keeps prompt/context and exposes Retry;
- success navigates to `/session/<id>?seed=<encoded prompt>`;
- no title field, dead attachment button, or dead voice button is rendered.

- [x] **Step 5: Verify screen RED**

Run:

```bash
cd mobile && npm run test:ui -- src/features/sessions/NewSessionScreen.test.tsx
```

Expected: FAIL because the screen is missing.

- [x] **Step 6: Implement the screen**

Use compact pressable selector rows and bottom sheets implemented with native
`Modal` for this slice. Fetch project catalog only after a project is selected.
Persist a single new-session draft per active profile in AsyncStorage. Clear it
only after thread creation succeeds and the seed handoff is stored in the
route.

- [x] **Step 7: Verify GREEN**

Run:

```bash
cd mobile
npm run test:unit -- src/features/sessions/new-session-state.test.ts
npm run test:ui -- src/features/sessions/NewSessionScreen.test.tsx
npm run typecheck
```

Expected: state, screen, and TypeScript checks pass.

- [x] **Step 8: Commit**

```bash
git add mobile/src/features/sessions/new-session-state.ts \
  mobile/src/features/sessions/new-session-state.test.ts \
  mobile/src/features/sessions/NewSessionScreen.tsx \
  mobile/src/features/sessions/NewSessionScreen.test.tsx mobile/app/new-session.tsx
git commit -m "feat(mobile): add composer-first session creation"
```

### Task 6: Add the initial live session screen and seed handoff

**Files:**

- Create: `mobile/src/realtime/assistant-session.ts`
- Create: `mobile/src/realtime/assistant-session.test.ts`
- Create: `mobile/src/features/sessions/session-reducer.ts`
- Create: `mobile/src/features/sessions/session-reducer.test.ts`
- Create: `mobile/src/features/sessions/SessionScreen.tsx`
- Create: `mobile/src/features/sessions/SessionScreen.test.tsx`
- Create: `mobile/app/session/[threadId].tsx`

- [x] **Step 1: Write failing reducer tests**

Prove history replacement, message deduplication, streaming delta accumulation,
tool-state updates, completion, and reconnect sync using the existing
snake_case channel event contract.

- [x] **Step 2: Verify reducer RED**

Run:

```bash
cd mobile && npm run test:unit -- src/features/sessions/session-reducer.test.ts
```

Expected: FAIL because the reducer is missing.

- [x] **Step 3: Implement the deterministic reducer**

Use:

```ts
export type SessionTimelineState = {
  messages: AssistantMessage[];
  streamingText: string;
  connectionState: "connecting" | "live" | "reconnecting" | "offline";
  error: string | null;
};
```

- [x] **Step 4: Write failing channel tests**

With a fake Phoenix socket/channel, prove:

- topic `assistant:thread:<positive id>`;
- one join and one leave;
- history/message/delta/completed bindings;
- `send_message` payload uses `{message: seed}`;
- reconnect requests history sync;
- seed is sent at most once after a successful join.

- [x] **Step 5: Verify channel RED**

Run:

```bash
cd mobile && npm run test:unit -- src/realtime/assistant-session.test.ts
```

Expected: FAIL because the adapter is missing.

- [x] **Step 6: Implement the adapter and screen**

The screen uses a bottom-anchored message list, explicit socket state, and a
multiline composer. It consumes the route seed exactly once, removes it from
navigation state after acceptance, and preserves it when channel join/send
fails.

- [x] **Step 7: Verify GREEN**

Run:

```bash
cd mobile
npm run test:unit -- src/realtime src/features/sessions/session-reducer.test.ts
npm run test:ui -- src/features/sessions/SessionScreen.test.tsx
npm run typecheck
```

Expected: session adapter, reducer, UI, and TypeScript checks pass.

- [x] **Step 8: Commit**

```bash
git add mobile/src/realtime mobile/src/features/sessions/session-reducer* \
  mobile/src/features/sessions/SessionScreen* mobile/app/session
git commit -m "feat(mobile): add live assistant session screen"
```

### Task 7: Validate the visual flow and update the PR

**Files:**

- Modify: `mobile/e2e/android-smoke.sh`
- Modify: `docs/superpowers/plans/2026-07-24-codex-style-mobile-sessions-plan.md`

- [ ] **Step 1: Extend the Android smoke flow**

Run the app with a deterministic local fixture transport enabled only by an E2E
launch argument. Record:

1. grouped session library;
2. search filtering;
3. `Chat` opening the full-screen composer;
4. project/workspace selectors;
5. prompt entry and session creation;
6. created session screen with the submitted seed.

Production builds without the launch argument must never use fixture data.

- [ ] **Step 2: Run the complete mobile gate**

Run:

```bash
cd mobile
npm test
npm run typecheck
npm run lint
npm run format:check
npm run doctor
npm run build:android:e2e
npm run test:e2e:android
```

Expected: every command exits zero.

- [ ] **Step 3: Inspect evidence**

Use `ffprobe` to require H.264, at least five seconds, and more than five
frames. Extract a contact sheet and visually confirm the library, composer, and
created session are readable with no blank frames.

- [ ] **Step 4: Mark plan evidence**

Record exact test counts, Expo Doctor count, APK SHA-256, video SHA-256,
duration, frame count, and artifact paths under a final `## Validation Results`
section in this plan.

- [ ] **Step 5: Commit and publish**

```bash
git add mobile/e2e/android-smoke.sh \
  docs/superpowers/plans/2026-07-24-codex-style-mobile-sessions-plan.md
git commit -m "test(mobile): validate Codex-style session flow"
git push origin agent/mobile-companion-e2e
```

Update draft PR #7 with the new flow summary and the refreshed video link.
