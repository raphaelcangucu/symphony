# Symphony Mobile Foundation Implementation Plan

**Goal:** Build the first runnable iOS/Android Symphony companion with secure server connections, an Orca-inspired home dashboard, project/task browsing, session browsing, and live assistant conversation.

**Architecture:** Add an independent Expo Router application in `mobile/`. Pure TypeScript modules own profile validation, API mapping, and assistant event reduction; React Query owns server state; a small connection provider binds SecureStore credentials to REST and Phoenix clients; feature screens compose focused mobile primitives.

**Tech Stack:** Expo 55, React Native 0.83, Expo Router, TypeScript 6, TanStack Query, Zustand, Phoenix JS, Expo SecureStore, AsyncStorage, Vitest, React Native Testing Library.

---

## File Map

### Application configuration

- `mobile/package.json` — scripts and dependency contract.
- `mobile/app.config.ts` — Expo identity, deep-link scheme, icons, and platform
  metadata.
- `mobile/tsconfig.json` — Expo TypeScript and `@/` alias configuration.
- `mobile/vitest.config.ts` — Node and React Native test projects.
- `mobile/metro.config.js` — Expo Metro defaults.
- `mobile/.gitignore` — native build and local cache exclusions.
- `mobile/app/_layout.tsx` — providers and root stack.
- `mobile/app/index.tsx` — connection-aware redirect.
- `mobile/app/connect.tsx` — connection setup route.
- `mobile/app/(tabs)/_layout.tsx` — main tab bar.
- `mobile/app/(tabs)/index.tsx` — Home route.
- `mobile/app/(tabs)/tasks.tsx` — Tasks route.
- `mobile/app/(tabs)/sessions.tsx` — Sessions route.
- `mobile/app/(tabs)/settings.tsx` — Settings route.
- `mobile/app/projects/[projectSlug].tsx` — project route.
- `mobile/app/session/[threadId].tsx` — assistant session route.

### Shared foundation

- `mobile/src/theme/tokens.ts` — dark/light semantic design tokens.
- `mobile/src/theme/ThemeProvider.tsx` — system theme selection and access.
- `mobile/src/components/AppScreen.tsx` — safe-area screen surface.
- `mobile/src/components/StateView.tsx` — loading, empty, and error states.
- `mobile/src/components/StatusDot.tsx` — semantic status marker.
- `mobile/src/components/SectionHeader.tsx` — section label/action.
- `mobile/src/components/PressableCard.tsx` — accessible raised row/card.
- `mobile/src/components/BrandMark.tsx` — Dev10x icon/name lockup.
- `mobile/src/components/ConnectionBadge.tsx` — live/cached/offline state.
- `mobile/src/test/render.tsx` — provider-aware render helper.
- `mobile/src/test/fixtures.ts` — representative tracker DTOs.

### Connection and transport

- `mobile/src/auth/connection-profile.ts` — profile types, URL normalization,
  deep-link parsing, and redaction.
- `mobile/src/auth/connection-profile.test.ts` — profile behavior tests.
- `mobile/src/auth/connection-storage.ts` — SecureStore/AsyncStorage persistence.
- `mobile/src/auth/connection-storage.test.ts` — storage contract tests.
- `mobile/src/auth/ConnectionProvider.tsx` — active connection lifecycle.
- `mobile/src/api/errors.ts` — typed tracker errors.
- `mobile/src/api/client.ts` — authenticated request client and validation.
- `mobile/src/api/client.test.ts` — request and envelope tests.
- `mobile/src/api/contracts.ts` — app-facing domain types.
- `mobile/src/api/mappers.ts` — DTO-to-domain normalization.
- `mobile/src/api/mappers.test.ts` — mapping tests.
- `mobile/src/realtime/socket-manager.ts` — profile-bound Phoenix socket.
- `mobile/src/realtime/assistant-session.ts` — assistant channel event adapter.
- `mobile/src/realtime/assistant-session.test.ts` — event/reducer tests.

### Features

- `mobile/src/features/connect/ConnectScreen.tsx` — URL/token validation and save.
- `mobile/src/features/connect/ConnectScreen.test.tsx` — setup behavior.
- `mobile/src/features/home/home-data.ts` — dashboard aggregation.
- `mobile/src/features/home/home-data.test.ts` — aggregation tests.
- `mobile/src/features/home/HomeScreen.tsx` — dashboard UI.
- `mobile/src/features/home/HomeScreen.test.tsx` — dashboard states.
- `mobile/src/features/projects/ProjectScreen.tsx` — project summary/navigation.
- `mobile/src/features/tasks/task-filters.ts` — filter reducer.
- `mobile/src/features/tasks/task-filters.test.ts` — filter tests.
- `mobile/src/features/tasks/TasksScreen.tsx` — project-aware task list.
- `mobile/src/features/tasks/TasksScreen.test.tsx` — list/filter states.
- `mobile/src/features/sessions/SessionsScreen.tsx` — grouped project sessions.
- `mobile/src/features/sessions/SessionsScreen.test.tsx` — grouping/navigation.
- `mobile/src/features/sessions/session-reducer.ts` — streaming timeline reducer.
- `mobile/src/features/sessions/session-reducer.test.ts` — streaming behavior.
- `mobile/src/features/sessions/SessionScreen.tsx` — live timeline and composer.
- `mobile/src/features/sessions/SessionScreen.test.tsx` — session behavior.
- `mobile/src/features/settings/SettingsScreen.tsx` — connection switch/remove and
  app metadata.

## Task 1: Scaffold the Expo application and test runner

**Files:**

- Create: `mobile/package.json`
- Create: `mobile/app.config.ts`
- Create: `mobile/tsconfig.json`
- Create: `mobile/vitest.config.ts`
- Create: `mobile/metro.config.js`
- Create: `mobile/.gitignore`
- Create: `mobile/app/_layout.tsx`
- Create: `mobile/app/index.tsx`

- [x] **Step 1: Create configuration-only scaffold**

Use the Expo 55 dependency matrix validated by Expo Doctor, plus the
tracker-compatible data packages. Orca remains the architecture/UX reference,
while native module versions follow Expo's supported runtime contract:

```json
{
  "name": "symphony-mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint",
    "doctor": "expo-doctor"
  },
  "dependencies": {
    "@expo/metro-runtime": "^55.0.11",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@tanstack/react-query": "^5.101.4",
    "expo": "^55.0.27",
    "expo-constants": "^55.0.16",
    "expo-font": "~55.0.8",
    "expo-linking": "^55.0.15",
    "expo-router": "^55.0.14",
    "expo-secure-store": "^55.0.13",
    "expo-splash-screen": "^55.0.20",
    "expo-status-bar": "^55.0.6",
    "lucide-react-native": "^1.25.0",
    "phoenix": "^1.8.9",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "react-native": "0.83.6",
    "react-native-gesture-handler": "~2.30.0",
    "react-native-reanimated": "4.2.1",
    "react-native-safe-area-context": "~5.6.2",
    "react-native-screens": "~4.23.0",
    "react-native-svg": "15.15.3",
    "react-native-web": "^0.21.2",
    "react-native-worklets": "0.7.4",
    "zod": "^4.4.3",
    "zustand": "^5.0.13"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "expo-doctor": "1.20.1",
    "oxfmt": "^0.52.0",
    "oxlint": "^1.71.0",
    "typescript": "~5.9.2",
    "vite": "^8.0.16",
    "vitest": "^4.1.10"
  }
}
```

Configure the app name as `Dev10x`, slug `symphony-mobile`, scheme `symphony`,
bundle id `dev.dev10x.symphony`, Android package
`dev.dev10x.symphony`, and enable typed Expo Router routes.

- [x] **Step 2: Install dependencies**

Run:

```bash
cd mobile
npm install
```

Expected: `mobile/package-lock.json` is created and install exits 0.

Result: PASS. The clean install added 797 packages. A transient registry
`ETIMEDOUT` was recovered with npm fetch retries; the final lockfile is present.

- [x] **Step 3: Add a minimal provider-free route**

`app/index.tsx` must temporarily render:

```tsx
import { Text, View } from "react-native";

export default function IndexRoute() {
  return (
    <View>
      <Text>Dev10x Mobile</Text>
    </View>
  );
}
```

`app/_layout.tsx` must render an Expo Router `Stack`.

- [x] **Step 4: Verify the generated application**

Run:

```bash
npm run typecheck
npm test -- --passWithNoTests
npx expo export --platform web
```

Expected: all commands exit 0 and Expo writes `dist/`.

Result: PASS. `npm test` passed 10 tests, typecheck and oxlint exited 0,
Expo Doctor passed 19/19 checks, and the web export wrote `mobile/dist`.

- [x] **Step 5: Commit**

```bash
git add mobile
git commit -m "feat(mobile): scaffold Expo companion"
```

## Task 2: Implement theme and shared primitives

**Files:**

- Create: `mobile/src/theme/tokens.ts`
- Create: `mobile/src/theme/ThemeProvider.tsx`
- Create: `mobile/src/components/AppScreen.tsx`
- Create: `mobile/src/components/StateView.tsx`
- Create: `mobile/src/components/StatusDot.tsx`
- Create: `mobile/src/components/SectionHeader.tsx`
- Create: `mobile/src/components/PressableCard.tsx`
- Create: `mobile/src/components/BrandMark.tsx`
- Create: `mobile/src/components/ConnectionBadge.tsx`
- Create: `mobile/src/components/__tests__/PressableCard.test.tsx`
- Modify: `mobile/app/_layout.tsx`

- [ ] **Step 1: Write failing primitive tests**

Cover:

```tsx
it("exposes a button role and label", () => {
  const screen = render(
    <PressableCard accessibilityLabel="Open project" onPress={() => undefined}>
      <Text>Project</Text>
    </PressableCard>,
  );
  expect(screen.getByRole("button", { name: "Open project" })).toBeTruthy();
});

it("renders status text in addition to color", () => {
  const screen = render(<ConnectionBadge state="offline" />);
  expect(screen.getByText("Offline")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/components/__tests__/PressableCard.test.tsx
```

Expected: FAIL because shared primitives do not exist.

- [ ] **Step 3: Implement semantic tokens and primitives**

Define dark and light palettes with the token keys:

```ts
export type ThemeColors = {
  bgBase: string;
  bgPanel: string;
  bgRaised: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  statusGreen: string;
  statusAmber: string;
  statusRed: string;
  statusPurple: string;
};
```

`PressableCard` must enforce `minHeight: 44`, pressed opacity/background, and an
accessibility role. `StateView` accepts exactly one of loading, error, or empty
presentation. `ConnectionBadge` maps `live`, `connecting`, `cached`, and
`offline` to text plus icon/dot.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npm test -- src/components/__tests__/PressableCard.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src mobile/app/_layout.tsx
git commit -m "feat(mobile): add native design system"
```

## Task 3: Build secure connection profiles

**Files:**

- Create: `mobile/src/auth/connection-profile.ts`
- Create: `mobile/src/auth/connection-profile.test.ts`
- Create: `mobile/src/auth/connection-storage.ts`
- Create: `mobile/src/auth/connection-storage.test.ts`
- Create: `mobile/src/auth/ConnectionProvider.tsx`

- [x] **Step 1: Write failing profile tests**

Tests must prove:

```ts
expect(normalizeTrackerOrigin(" https://demo.test/tracker/ ")).toBe(
  "https://demo.test",
);
expect(() => normalizeTrackerOrigin("javascript:alert(1)")).toThrow(
  "Only http and https tracker URLs are supported",
);
expect(parseConnectionDeepLink(
  "symphony://connect?url=https%3A%2F%2Fdemo.test&token=secret",
)).toEqual({ origin: "https://demo.test", token: "secret" });
expect(redactSecret("Bearer secret-value", "secret-value")).toBe(
  "Bearer [REDACTED]",
);
```

- [x] **Step 2: Run profile tests and verify RED**

Run:

```bash
npm test -- src/auth/connection-profile.test.ts
```

Expected: FAIL because functions do not exist.

Result: RED observed: Vitest failed to resolve `./connection-profile`, then
failed two added profile-construction cases because
`createConnectionProfile` did not exist.

- [x] **Step 3: Implement profile normalization**

Use:

```ts
export interface ConnectionProfile {
  id: string;
  name: string;
  origin: string;
  createdAt: string;
  lastConnectedAt: string | null;
}

export interface ConnectionCredential {
  profileId: string;
  token: string;
}
```

Profile ids are stable UUIDs. URL normalization strips `/tracker` and trailing
slashes, rejects credentials/fragments, and permits only HTTP(S). Deep links
require both URL and non-blank token.

- [x] **Step 4: Run profile tests and verify GREEN**

Run:

```bash
npm test -- src/auth/connection-profile.test.ts
```

Expected: PASS.

Result: GREEN observed: 10/10 profile tests passed.

- [ ] **Step 5: Write failing storage contract tests**

Use injected AsyncStorage and SecureStore adapters. Prove that metadata is
written to AsyncStorage, token is written only to SecureStore under
`symphony.connection.<id>.token`, removing a profile deletes both, and active
profile falls back to the first remaining profile.

- [ ] **Step 6: Run storage tests and verify RED**

Run:

```bash
npm test -- src/auth/connection-storage.test.ts
```

Expected: FAIL because storage is missing.

- [ ] **Step 7: Implement storage and provider**

The provider exposes:

```ts
type ConnectionContextValue = {
  profiles: ConnectionProfile[];
  activeProfile: ConnectionProfile | null;
  activeToken: string | null;
  hydrated: boolean;
  selectProfile(id: string): Promise<void>;
  saveProfile(input: SaveConnectionInput): Promise<ConnectionProfile>;
  removeProfile(id: string): Promise<void>;
  replaceToken(id: string, token: string): Promise<void>;
};
```

Hydration must never place a token in persisted Zustand/AsyncStorage state.

- [ ] **Step 8: Run tests and verify GREEN**

Run:

```bash
npm test -- src/auth
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/auth
git commit -m "feat(mobile): persist secure tracker connections"
```

## Task 4: Implement the typed REST client and domain mappers

**Files:**

- Create: `mobile/src/api/errors.ts`
- Create: `mobile/src/api/client.ts`
- Create: `mobile/src/api/client.test.ts`
- Create: `mobile/src/api/contracts.ts`
- Create: `mobile/src/api/mappers.ts`
- Create: `mobile/src/api/mappers.test.ts`
- Create: `mobile/src/test/fixtures.ts`

- [ ] **Step 1: Write failing client tests**

Using an injected `fetch`, prove:

```ts
await client.get("/viewer");
expect(fetch).toHaveBeenCalledWith(
  "https://demo.test/api/tracker/v1/viewer",
  expect.objectContaining({
    headers: expect.objectContaining({
      Authorization: "Bearer secret",
      "X-Symphony-Locale": "pt-BR",
    }),
  }),
);
```

Also prove envelope unwrapping, 401 → `TrackerAuthError`, timeout →
`TrackerTimeoutError`, non-JSON response → `TrackerProtocolError`, and token
redaction from every thrown message.

- [ ] **Step 2: Run client tests and verify RED**

Run:

```bash
npm test -- src/api/client.test.ts
```

Expected: FAIL because client is missing.

- [ ] **Step 3: Implement request client**

Expose:

```ts
export type TrackerClient = {
  health(signal?: AbortSignal): Promise<Health>;
  viewer(signal?: AbortSignal): Promise<Viewer>;
  projects(signal?: AbortSignal): Promise<Project[]>;
  issues(projectSlug: string, query?: string, signal?: AbortSignal): Promise<Issue[]>;
  recents(limit?: number, signal?: AbortSignal): Promise<RecentSession[]>;
  sessions(projectSlug: string, signal?: AbortSignal): Promise<ProjectSession[]>;
  threads(options?: ThreadListOptions, signal?: AbortSignal): Promise<AssistantThread[]>;
  agentUsage(signal?: AbortSignal): Promise<AgentUsageMap>;
};
```

All URL path segments use `encodeURIComponent`; GETs accept an AbortSignal; the
default timeout is 30 seconds.

- [ ] **Step 4: Run client tests and verify GREEN**

Run:

```bash
npm test -- src/api/client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing mapper tests**

Use real-shape fixture DTOs copied from the tracker service contracts and prove:

- unknown agent kinds map to `null`;
- missing arrays map to empty arrays;
- issue priorities remain `0..4 | null`;
- session hrefs lose a leading `/tracker`;
- usage percentages clamp to `0..100`;
- invalid required ids/titles throw `TrackerProtocolError`.

- [ ] **Step 6: Run mapper tests and verify RED**

Run:

```bash
npm test -- src/api/mappers.test.ts
```

Expected: FAIL because mappers are missing.

- [ ] **Step 7: Implement contracts and mappers**

Keep DTO types private to `mappers.ts`. Export only app-facing camelCase types
from `contracts.ts`. Do not reuse browser-only types containing `File`,
`window`, or Vite globals.

- [ ] **Step 8: Run API tests and verify GREEN**

Run:

```bash
npm test -- src/api
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/api mobile/src/test/fixtures.ts
git commit -m "feat(mobile): add typed tracker API client"
```

## Task 5: Add connection setup and navigation shell

**Files:**

- Create: `mobile/src/features/connect/ConnectScreen.tsx`
- Create: `mobile/src/features/connect/ConnectScreen.test.tsx`
- Create: `mobile/app/connect.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/app/(tabs)/tasks.tsx`
- Create: `mobile/app/(tabs)/sessions.tsx`
- Create: `mobile/app/(tabs)/settings.tsx`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/index.tsx`

- [ ] **Step 1: Write failing setup screen tests**

Prove that:

- blank input keeps Connect disabled;
- invalid URL renders the exact validation message;
- the screen validates health and viewer before calling `saveProfile`;
- 401 renders “Invalid tracker token” without echoing the token;
- successful save replaces the route with `/(tabs)`.

- [ ] **Step 2: Run setup tests and verify RED**

Run:

```bash
npm test -- src/features/connect/ConnectScreen.test.tsx
```

Expected: FAIL because the screen does not exist.

- [ ] **Step 3: Implement setup screen and connection-aware redirect**

The setup screen uses labeled URL, name, and secure token fields, a single
primary Connect button, and a short instruction pointing to the tracker token.
`app/index.tsx` waits for storage hydration, then redirects to `/connect` or
`/(tabs)`.

The tab bar contains Home, Tasks, Sessions, and Settings with labels and
Lucide icons. It uses the active theme and safe-area insets.

- [ ] **Step 4: Run setup tests and verify GREEN**

Run:

```bash
npm test -- src/features/connect
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app mobile/src/features/connect
git commit -m "feat(mobile): add secure connection onboarding"
```

## Task 6: Build the Orca-inspired Home dashboard

**Files:**

- Create: `mobile/src/features/home/home-data.ts`
- Create: `mobile/src/features/home/home-data.test.ts`
- Create: `mobile/src/features/home/HomeScreen.tsx`
- Create: `mobile/src/features/home/HomeScreen.test.tsx`
- Create: `mobile/src/components/BrandMark.tsx`
- Create: `mobile/src/components/SectionHeader.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Write failing aggregation tests**

Given projects, recents, threads, and usage, prove:

```ts
expect(buildHomeSummary(input)).toMatchObject({
  projectCount: 3,
  activeSessionCount: 2,
  attentionCount: 1,
  resumable: expect.arrayContaining([
    expect.objectContaining({ threadId: 42 }),
  ]),
});
```

Running/retrying/waiting statuses count as active; `needsReview` counts as
attention; resumable items are deduplicated by thread id and sorted newest
first.

- [ ] **Step 2: Run aggregation tests and verify RED**

Run:

```bash
npm test -- src/features/home/home-data.test.ts
```

Expected: FAIL because aggregation is missing.

- [ ] **Step 3: Implement aggregation**

Keep the aggregator pure and independent of React Query.

- [ ] **Step 4: Run aggregation tests and verify GREEN**

Run:

```bash
npm test -- src/features/home/home-data.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing dashboard screen tests**

Prove the screen renders:

- Dev10x brand and connection state;
- four summary values;
- connection card;
- recent/resumable session rows;
- account usage windows;
- New task, New session, and Refresh quick actions;
- cached content plus an offline banner after a refresh failure.

- [ ] **Step 6: Run dashboard tests and verify RED**

Run:

```bash
npm test -- src/features/home/HomeScreen.test.tsx
```

Expected: FAIL because the screen is missing.

- [ ] **Step 7: Implement dashboard**

Use parallel React Query queries for projects, recents, threads, executions,
and usage. The layout follows the reference hierarchy: compact top bar,
greeting, horizontal stats row, section labels, 14-point cards, and bottom safe
area. Pull-to-refresh invalidates all home query keys.

- [ ] **Step 8: Run dashboard tests and verify GREEN**

Run:

```bash
npm test -- src/features/home
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/features/home mobile/src/components mobile/app/'(tabs)'/index.tsx
git commit -m "feat(mobile): add companion dashboard"
```

## Task 7: Add project and task browsing

**Files:**

- Create: `mobile/src/features/projects/ProjectScreen.tsx`
- Create: `mobile/src/features/tasks/task-filters.ts`
- Create: `mobile/src/features/tasks/task-filters.test.ts`
- Create: `mobile/src/features/tasks/TasksScreen.tsx`
- Create: `mobile/src/features/tasks/TasksScreen.test.tsx`
- Create: `mobile/app/projects/[projectSlug].tsx`
- Modify: `mobile/app/(tabs)/tasks.tsx`

- [ ] **Step 1: Write failing filter tests**

Prove:

```ts
expect(filterTasks(tasks, {
  query: "oauth",
  projectSlug: "api",
  statuses: new Set(["In Progress"]),
  priorities: new Set([1]),
})).toEqual([tasks[1]]);
```

Search is case/diacritic-insensitive across title, identifier, labels, and
assignee. Empty filter sets mean “all”.

- [ ] **Step 2: Run filter tests and verify RED**

Run:

```bash
npm test -- src/features/tasks/task-filters.test.ts
```

Expected: FAIL because filtering is missing.

- [ ] **Step 3: Implement filtering and grouping**

Group results by workflow status in the server-provided order. Preserve stable
position order inside each status.

- [ ] **Step 4: Run filter tests and verify GREEN**

Run:

```bash
npm test -- src/features/tasks/task-filters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing task screen tests**

Prove:

- all projects are available in the project selector;
- selecting a project fetches and renders its issues;
- rows show identifier, title, status, priority, assignee, labels, and agent;
- search filters visible rows;
- loading, empty, error, and stale states are explicit;
- tapping a row opens `/issue/<project>/<identifier>` (the detail route is
  delivered in the next slice, so this route may show a clear “coming in Task
  Operations” state rather than silently do nothing).

- [ ] **Step 6: Run task screen tests and verify RED**

Run:

```bash
npm test -- src/features/tasks/TasksScreen.test.tsx
```

Expected: FAIL because the screen is missing.

- [ ] **Step 7: Implement task and project screens**

Tasks uses a searchable `FlatList`, project selector drawer, status/priority
chips, pull-to-refresh, and sticky section headings. Project screen shows
description, sync health, issue count, repositories, recent sessions, and
buttons to Tasks and New session.

- [ ] **Step 8: Run task tests and verify GREEN**

Run:

```bash
npm test -- src/features/tasks
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/features/tasks mobile/src/features/projects mobile/app
git commit -m "feat(mobile): add project and task browsing"
```

## Task 8: Add session browsing and grouping

**Files:**

- Create: `mobile/src/features/sessions/session-groups.ts`
- Create: `mobile/src/features/sessions/session-groups.test.ts`
- Create: `mobile/src/features/sessions/SessionsScreen.tsx`
- Create: `mobile/src/features/sessions/SessionsScreen.test.tsx`
- Modify: `mobile/app/(tabs)/sessions.tsx`

- [ ] **Step 1: Write failing grouping tests**

Given project session rows and assistant threads, prove that each stable id
appears once in priority order:

```text
needs attention → running → pinned → recent → archived
```

Within a group, sort by `updatedAt` descending.

- [ ] **Step 2: Run grouping tests and verify RED**

Run:

```bash
npm test -- src/features/sessions/session-groups.test.ts
```

Expected: FAIL because grouping is missing.

- [ ] **Step 3: Implement grouping**

Return typed sections ready for `SectionList`; do not couple the pure grouping
function to React Native.

- [ ] **Step 4: Run grouping tests and verify GREEN**

Run:

```bash
npm test -- src/features/sessions/session-groups.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing screen tests**

Prove project switching, section labels, agent/status chips, empty/error states,
archive toggle, and navigation to `/session/<threadId>`.

- [ ] **Step 6: Run screen tests and verify RED**

Run:

```bash
npm test -- src/features/sessions/SessionsScreen.test.tsx
```

Expected: FAIL because screen is missing.

- [ ] **Step 7: Implement Sessions screen**

Use the selected project for `/projects/:slug/sessions` and supplement rows
with `/assistant/threads?project_slug=:slug`. Use a `SectionList`, search field,
project drawer, archive toggle, pull-to-refresh, and compact status cards.

- [ ] **Step 8: Run screen tests and verify GREEN**

Run:

```bash
npm test -- src/features/sessions
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/features/sessions mobile/app/'(tabs)'/sessions.tsx
git commit -m "feat(mobile): add session browser"
```

## Task 9: Implement live assistant read/compose

**Files:**

- Create: `mobile/src/realtime/socket-manager.ts`
- Create: `mobile/src/realtime/assistant-session.ts`
- Create: `mobile/src/realtime/assistant-session.test.ts`
- Create: `mobile/src/features/sessions/session-reducer.ts`
- Create: `mobile/src/features/sessions/session-reducer.test.ts`
- Create: `mobile/src/features/sessions/SessionScreen.tsx`
- Create: `mobile/src/features/sessions/SessionScreen.test.tsx`
- Create: `mobile/app/session/[threadId].tsx`

- [ ] **Step 1: Write failing timeline reducer tests**

Prove:

- `history_loaded` replaces history and preserves ascending sequence;
- `message_created` deduplicates by id;
- consecutive `assistant_delta` events update one transient assistant item;
- `tool_call_started` and `tool_call_completed` update the matching tool;
- `assistant_completed` replaces the transient item;
- reconnect `history_synced` removes duplicate transient content;
- an event for a different thread is ignored.

- [ ] **Step 2: Run reducer tests and verify RED**

Run:

```bash
npm test -- src/features/sessions/session-reducer.test.ts
```

Expected: FAIL because reducer is missing.

- [ ] **Step 3: Implement reducer**

Use:

```ts
export type SessionTimelineState = {
  messages: AssistantMessage[];
  streamingText: string;
  activeTools: AssistantToolCall[];
  turnStatus: AssistantTurnStatus | null;
  connectionState: "connecting" | "live" | "reconnecting" | "offline";
  error: string | null;
};
```

The reducer must be deterministic and side-effect free.

- [ ] **Step 4: Run reducer tests and verify GREEN**

Run:

```bash
npm test -- src/features/sessions/session-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing channel adapter tests**

With a fake Phoenix channel, prove topic
`assistant:thread:<positive-thread-id>`, event binding for history/message/delta/
tool/completed/error/turn status, message push payload, reconnect sync request,
and cleanup leaving the channel exactly once.

- [ ] **Step 6: Run adapter tests and verify RED**

Run:

```bash
npm test -- src/realtime/assistant-session.test.ts
```

Expected: FAIL because adapter is missing.

- [ ] **Step 7: Implement socket manager and assistant adapter**

The socket URL is `<origin>/socket`; params include token and locale. The
session adapter exposes:

```ts
export type AssistantSessionConnection = {
  subscribe(listener: (event: AssistantSessionEvent) => void): () => void;
  sendMessage(text: string): Promise<void>;
  requestHistorySync(): void;
  close(): void;
};
```

Use the channel's actual message event contract from
`tracker/src/services/phoenix/assistantChannel.ts`; do not invent a second wire
format.

- [ ] **Step 8: Run adapter tests and verify GREEN**

Run:

```bash
npm test -- src/realtime
```

Expected: PASS.

- [ ] **Step 9: Write failing Session screen tests**

Prove:

- history renders user/assistant/tool messages;
- streaming text appears without duplicating the final message;
- composer rejects blank input;
- sending clears the draft only after the channel accepts it;
- offline state preserves the draft and disables Send;
- reconnect indicator and retry action are visible;
- back navigation, title, agent, and turn status are accessible.

- [ ] **Step 10: Run screen tests and verify RED**

Run:

```bash
npm test -- src/features/sessions/SessionScreen.test.tsx
```

Expected: FAIL because screen is missing.

- [ ] **Step 11: Implement Session screen**

Use an inverted or bottom-anchored performant list, Markdown-safe plain-text
fallback for this slice, streaming cursor, compact tool cards, multiline
composer, keyboard avoidance, and safe-area padding. Persist drafts by thread
id in AsyncStorage. Keep approval/question/model controls out of this slice;
their event data remains represented in the adapter for the next slice.

- [ ] **Step 12: Run session tests and verify GREEN**

Run:

```bash
npm test -- src/features/sessions
npm run typecheck
```

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add mobile/src/realtime mobile/src/features/sessions mobile/app/session
git commit -m "feat(mobile): add live assistant sessions"
```

## Task 10: Add settings, polish, and foundation evidence

**Files:**

- Create: `mobile/src/features/settings/SettingsScreen.tsx`
- Create: `mobile/src/features/settings/SettingsScreen.test.tsx`
- Modify: `mobile/app/(tabs)/settings.tsx`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-23-symphony-mobile-foundation-plan.md`

- [ ] **Step 1: Write failing Settings tests**

Prove profile switching, replace-token navigation, profile removal confirmation,
theme selection, app version, and redacted connection diagnostics.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/features/settings/SettingsScreen.test.tsx
```

Expected: FAIL because Settings is missing.

- [ ] **Step 3: Implement Settings and documentation**

Settings shows saved connections with live status, active marker, Add
connection, Replace token, and Remove actions. README gains exact commands:

```bash
cd mobile
npm install
npm start
npm run ios
npm run android
```

Document that the phone must reach the Symphony origin and that a public tunnel
or LAN URL may be used.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npm test -- src/features/settings
```

Expected: PASS.

- [ ] **Step 5: Run the complete foundation gate**

Run:

```bash
cd mobile
npm test
npm run typecheck
npm run lint
npm run doctor
npx expo export --platform web
```

Expected: every command exits 0.

- [ ] **Step 6: Run existing tracker regression gate**

Run:

```bash
cd tracker
npm test
npm run build
```

Expected: every command exits 0.

- [ ] **Step 7: Capture manual evidence**

At 390×844 and 430×932 validate:

1. new install → Connect;
2. valid profile → Home;
3. project → Tasks → search/filter;
4. Sessions → live thread → send follow-up;
5. disconnect/reconnect with cached content;
6. Settings → switch connection.

Save screenshots under
`docs/evidence/symphony-mobile-foundation/<platform>-<flow>.png`.

- [ ] **Step 8: Update plan checkboxes with exact results**

For every completed task, mark the checkbox and append the relevant command
result or evidence path. Do not mark unsupported simulator/device flows as
complete.

- [ ] **Step 9: Commit**

```bash
git add mobile README.md docs
git commit -m "docs(mobile): document companion development"
```
