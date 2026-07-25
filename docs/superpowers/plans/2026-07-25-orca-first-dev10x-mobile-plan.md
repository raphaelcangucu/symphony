# Orca-First Dev10x Mobile Implementation Plan

**Goal:** Ship Dev10x Mobile with the production Orca Mobile experience as its default interface, backed by Symphony's direct encrypted multi-host RPC, while preserving the existing Codex-style interface as one device-wide alternate view.

**Architecture:** Vendor the tested Orca Mobile frontend at commit `5c3c2f2b3daf9d8563581c389712d805bfb256a1` with minimal presentation changes, then satisfy its existing client contract through a thin `SymphonyOrcaRpcClient` and host-scoped runtime. Extend Symphony's allowlisted mobile RPC on each host to provide the method and stream shapes consumed by that frontend. Both Orca and Codex shells share pairing, secure credentials, selected-host state, caches and transports; the standalone mock uses the production transport, while release E2E uses two real local Symphony hosts.

**Tech Stack:** Expo 55, React Native 0.83, Expo Router, TypeScript, Zustand, AsyncStorage, SecureStore, WebSocket RPC, X25519/HKDF/ChaCha20-Poly1305, Elixir/Phoenix, ExUnit, Vitest/Jest, Android Gradle, ADB, FFmpeg.

---

## Guardrails

- **Brand:** Dev10x is the primary and visible application brand. The app
  name, icons, splash, onboarding headings, settings identity and about screen
  say `Dev10x`. `Symphony` is used only for the paired host/runtime, RPC
  protocol and domain-specific technical messages.
- **Reuse:** Copy the upstream Orca implementation and tests. Do not recreate
  screens from screenshots, simplify its interaction model or replace working
  upstream components with new visual equivalents.
- **Backend boundary:** Keep copied screen behavior stable. Adapt the encrypted
  transport and add allowlisted host RPC handlers instead of spreading
  Symphony-specific network calls through screens.
- **Mock boundary:** Keep `npm run mock-server` for deterministic development.
  Published acceptance E2E must use real local Symphony hosts.
- **WSL safety:** Run only focused test files, type-check/lint for touched
  packages, local APK builds and selected E2E journeys. Do not run the full
  unit suite or unbounded `make-all`.
- **Source control:** Merge `origin/main`; do not rebase or force-push. Keep
  mechanical Orca imports, RPC behavior and evidence in reviewable commits.

## Target File Structure

```text
mobile/
├── ORCA_UPSTREAM.md
├── THIRD_PARTY_NOTICES.md
├── app.config.ts
├── app/
│   ├── _layout.tsx                  # shared runtime + Dev10x root stack
│   ├── index.tsx                    # global view-mode gate
│   ├── pair*.tsx                    # copied Orca onboarding, Symphony pairing
│   ├── h/[hostId]/...               # copied Orca host/workspace experience
│   └── codex/...                    # existing Codex-style route entry points
├── assets/
│   └── dev10x-*.png                 # mobile-safe copies of canonical brand
├── src/
│   ├── brand/                       # Dev10x identity and copy invariants
│   ├── preferences/                 # device-wide view-mode state
│   ├── rpc/                         # existing Symphony encrypted transport
│   ├── runtime/                     # shared multi-host runtime
│   ├── orca/
│   │   ├── browser/
│   │   ├── components/
│   │   ├── files/
│   │   ├── session/
│   │   ├── source-control/
│   │   ├── tasks/
│   │   ├── theme/
│   │   └── transport/               # client facade, not Orca wire crypto
│   └── features/                    # preserved Codex-style UI
└── scripts/mock-server*.ts          # external production-path mock

elixir/lib/symphony_elixir/mobile_rpc/
├── methods/orca_system.ex
├── methods/orca_workspaces.ex
├── methods/orca_sessions.ex
├── methods/orca_files.ex
├── methods/orca_git.ex
├── methods/orca_tasks.ex
├── orca_presenter.ex
└── orca_subscription.ex
```

The `mobile/src/orca/` tree preserves upstream folder boundaries. It does not
contain Orca's handshake implementation or its persistent host store; those
responsibilities stay in the shared Symphony core.

### Task 1: Merge the Latest `origin/main` into the PR Branch

**Files:**

- Inspect conflicts in all changed files.
- Modify only files with semantic merge conflicts.
- Regenerate lockfiles only if dependency sources conflict.

- [x] **Step 1: Commit the approved Dev10x spec clarification and this plan**

Run:

```bash
git add docs/reports/2026-07-25-orca-vs-symphony-mobile.md \
  docs/superpowers/specs/2026-07-25-orca-first-symphony-mobile-design.md \
  docs/superpowers/plans/2026-07-25-orca-first-dev10x-mobile-plan.md
git diff --cached --check
git commit -m "docs(mobile): plan Orca-first Dev10x migration"
```

Expected: one documentation commit and a clean worktree.

- [x] **Step 2: Enable recorded conflict resolution**

Run:

```bash
git config rerere.enabled true
git config rerere.autoupdate true
git status --short --branch
```

Expected: current branch is `agent/mobile-companion-e2e` and the worktree is
clean.

- [x] **Step 3: Fetch and fast-forward the remote feature branch**

Run:

```bash
git fetch origin
git pull --ff-only origin "$(git branch --show-current)"
```

Expected: the branch is current with `origin/agent/mobile-companion-e2e`; the
command must not create a rebase.

- [x] **Step 4: Merge the latest main branch**

Run:

```bash
git -c merge.conflictstyle=zdiff3 merge origin/main
```

Expected: a merge commit or a conflict list. If conflicts exist, inspect each
with `git diff --merge`, preserve both the current mobile RPC architecture and
new main behavior, stage resolved files, then run `git merge --continue`.

- [x] **Step 5: Verify the merged baseline without a heavy suite**

Run:

```bash
git diff --check
cd mobile
npm run typecheck
npm run lint
```

Expected: no conflict markers, TypeScript errors or lint errors. If main
changes a mobile contract, update this plan's exact type names before Task 2.

- [x] **Step 6: Record the merge result**

Run:

```bash
git status --short --branch
git log -3 --oneline
```

Expected: clean worktree with `origin/main` in branch ancestry.

### Task 2: Pin Orca Provenance, Licensing and the Dev10x Brand

**Files:**

- Create: `mobile/ORCA_UPSTREAM.md`
- Create: `mobile/THIRD_PARTY_NOTICES.md`
- Create: `mobile/src/brand/dev10x.ts`
- Create: `mobile/src/brand/dev10x-brand.test.ts`
- Create: `mobile/assets/dev10x-logo-white.png`
- Create: `mobile/assets/dev10x-logo-color.png`
- Create: `mobile/assets/dev10x-icon.png`
- Modify: `mobile/app.config.ts`
- Modify: `mobile/package.json`

- [x] **Step 1: Write the failing brand and provenance test**

Create `mobile/src/brand/dev10x-brand.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_BRAND, HOST_RUNTIME_NAME } from "./dev10x";

const root = resolve(__dirname, "../..");

describe("Dev10x mobile brand", () => {
  it("keeps Dev10x as the app brand and Symphony as the host runtime", () => {
    expect(APP_BRAND).toBe("Dev10x");
    expect(HOST_RUNTIME_NAME).toBe("Symphony");
    expect(readFileSync(resolve(root, "app.config.ts"), "utf8")).toContain('name: "Dev10x"');
  });

  it("records the exact Orca source and MIT attribution", () => {
    expect(readFileSync(resolve(root, "ORCA_UPSTREAM.md"), "utf8")).toContain(
      "5c3c2f2b3daf9d8563581c389712d805bfb256a1",
    );
    expect(readFileSync(resolve(root, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain(
      "Copyright (c) 2026 Lovecast Inc.",
    );
  });
});
```

- [x] **Step 2: Run the test and confirm the missing files fail**

Run:

```bash
cd mobile
npx vitest run src/brand/dev10x-brand.test.ts
```

Expected: FAIL because `dev10x.ts`, `ORCA_UPSTREAM.md` and
`THIRD_PARTY_NOTICES.md` do not exist.

- [x] **Step 3: Add the canonical brand constants**

Create `mobile/src/brand/dev10x.ts`:

```ts
export const APP_BRAND = "Dev10x" as const;
export const HOST_RUNTIME_NAME = "Symphony" as const;
export const APP_TAGLINE = "Your development workspace, anywhere." as const;

export function hostLabel(name: string): string {
  return name.trim() ? `${name.trim()} · Symphony host` : "Symphony host";
}
```

Write `mobile/ORCA_UPSTREAM.md` with the repository URL, exact baseline commit,
import date, copied directories, excluded Orca crypto/host-store files and the
command used to compare future upstream changes. Write
`mobile/THIRD_PARTY_NOTICES.md` with the complete Orca MIT license text.

- [x] **Step 4: Copy the canonical Dev10x assets**

Run:

```bash
cp tracker/public/dev10x_logo_white.png mobile/assets/dev10x-logo-white.png
cp tracker/public/dev10x_logo_color.png mobile/assets/dev10x-logo-color.png
cp tracker/public/dev10x_icon.png mobile/assets/dev10x-icon.png
```

Expected: the three mobile assets are byte-identical to the canonical tracker
assets. `app.config.ts` continues to declare `name: "Dev10x"` and uses Dev10x
permission copy; it does not declare Orca as a display name.

- [x] **Step 5: Run the focused test**

Run:

```bash
cd mobile
npx vitest run src/brand/dev10x-brand.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit the brand and provenance**

Run:

```bash
git add mobile/ORCA_UPSTREAM.md mobile/THIRD_PARTY_NOTICES.md \
  mobile/src/brand mobile/assets mobile/app.config.ts mobile/package.json
git commit -m "chore(mobile): establish Dev10x brand and Orca provenance"
```

### Task 3: Add the Device-Wide Orca/Codex View Preference

**Files:**

- Create: `mobile/src/preferences/view-mode.ts`
- Create: `mobile/src/preferences/view-mode.test.ts`
- Create: `mobile/src/preferences/ViewModeProvider.tsx`
- Create: `mobile/src/preferences/ViewModeProvider.test.tsx`
- Modify: `mobile/src/runtime/AppRuntime.tsx`
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/index.tsx`
- Modify: `mobile/src/features/settings/SettingsScreen.tsx`
- Modify: `mobile/src/features/settings/SettingsRoute.tsx`

- [x] **Step 1: Write the failing persistence test**

Create `mobile/src/preferences/view-mode.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createViewModeStorage } from "./view-mode";

describe("view mode preference", () => {
  it("defaults to Orca and stores one device-wide value", async () => {
    const values = new Map<string, string>();
    const storage = createViewModeStorage({
      getItem: vi.fn(async (key) => values.get(key) ?? null),
      setItem: vi.fn(async (key, value) => void values.set(key, value)),
    });

    await expect(storage.load()).resolves.toBe("orca");
    await storage.save("codex");
    await expect(storage.load()).resolves.toBe("codex");
    expect(values.has("dev10x:mobile:view-mode")).toBe(true);
  });

  it("falls back to Orca for corrupt values", async () => {
    const storage = createViewModeStorage({
      getItem: async () => "other",
      setItem: async () => undefined,
    });
    await expect(storage.load()).resolves.toBe("orca");
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

Run:

```bash
cd mobile
npx vitest run src/preferences/view-mode.test.ts
```

Expected: FAIL because `createViewModeStorage` does not exist.

- [x] **Step 3: Implement the storage contract**

Create `mobile/src/preferences/view-mode.ts`:

```ts
export type MobileViewMode = "orca" | "codex";

type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const VIEW_MODE_KEY = "dev10x:mobile:view-mode";

export function createViewModeStorage(storage: KeyValueStorage) {
  return {
    async load(): Promise<MobileViewMode> {
      return (await storage.getItem(VIEW_MODE_KEY)) === "codex" ? "codex" : "orca";
    },
    save(mode: MobileViewMode): Promise<void> {
      return storage.setItem(VIEW_MODE_KEY, mode);
    },
  };
}
```

Add `ViewModeProvider` with `{hydrated, mode, setMode}`. Its production storage
is AsyncStorage; tests inject an in-memory storage. Add the provider above the
navigation stack in `app/_layout.tsx`.

- [x] **Step 4: Make root selection independent of the selected host**

Implementation note: the provider and settings control land first. The root
switch is completed immediately after `OrcaHomeRoute` is vendored in Task 4,
so the branch never carries a synthetic placeholder that differs from
upstream Orca.

`mobile/app/index.tsx` must render the Orca home route when mode is `orca` and
the existing `ConnectionGate` + `SessionLibraryRoute` when mode is `codex`:

```tsx
export default function IndexRoute() {
  const { hydrated, mode } = useViewMode();
  if (!hydrated) return null;
  if (mode === "codex") {
    return (
      <ConnectionGate>
        <SessionLibraryRoute />
      </ConnectionGate>
    );
  }
  return <OrcaHomeRoute />;
}
```

Add an Orca-style settings row labeled `Interface` with values
`Dev10x Workspace` and `Compact Sessions`. Do not use Orca as a user-visible
mode name.

- [x] **Step 5: Run focused preference and settings tests**

Run:

```bash
cd mobile
npx vitest run src/preferences/view-mode.test.ts
npx jest src/preferences/ViewModeProvider.test.tsx \
  src/features/settings/SettingsScreen.test.tsx --runInBand
```

Expected: PASS; changing modes does not call connection storage or transport
cleanup.

- [x] **Step 6: Commit**

```bash
git add mobile/app mobile/src/preferences mobile/src/runtime \
  mobile/src/features/settings
git commit -m "feat(mobile): add device-wide interface preference"
```

### Task 4: Vendor the Production Orca Frontend without Its Wire Crypto

**Files:**

- Create: `mobile/src/orca/**` from upstream `mobile/src/**`
- Create: `mobile/app/pair-scan.tsx`
- Create or replace: `mobile/app/pair.tsx`
- Create: `mobile/app/pair-confirm.tsx`
- Create: `mobile/app/h/_layout.tsx`
- Create: `mobile/app/h/[hostId]/**`
- Create: `mobile/app/about.tsx`
- Create: `mobile/app/browser-settings.tsx`
- Create: `mobile/app/terminal-settings.tsx`
- Create: `mobile/app/voice-settings.tsx`
- Create: `mobile/app/troubleshoot.tsx`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`
- Modify: `mobile/tsconfig.json`

- [x] **Step 1: Verify the exact upstream checkout**

Run:

```bash
ORCA_SOURCE=/home/raphaelcangucu/orca
test "$(git -C "$ORCA_SOURCE" rev-parse HEAD)" = \
  "5c3c2f2b3daf9d8563581c389712d805bfb256a1"
git -C "$ORCA_SOURCE" status --short
```

Expected: the exact pinned commit and no uncommitted upstream source edits.

- [x] **Step 2: Import the upstream presentation directories mechanically**

Copy the following upstream directories intact into `mobile/src/orca/`:

```text
browser
cache
components
constants
diagnostics
dictation
files
hooks
layout
notifications
platform
session
source-control
storage
tasks
terminal
theme
worktree
```

The production routes import these three additional directories directly, so
they are part of the pinned mechanical source boundary. Copy the required
non-cryptographic transport helpers and their exact `src/shared/` type
dependencies as well; continue to exclude the five transport implementations
listed below.

Also copy the upstream route files listed in the Files section. Rewrite only
their import roots from `src/...` to `src/orca/...`. Do not copy:

```text
src/transport/e2ee.ts
src/transport/rpc-client.ts
src/transport/client-context.tsx
src/transport/host-store.ts
src/transport/pairing.ts
```

Those five files are replaced by Symphony adapters in Tasks 5 and 6.

Use this bounded mechanical import:

```bash
ORCA_SOURCE=/home/raphaelcangucu/orca
mkdir -p mobile/src/orca mobile/src/orca/routes mobile/src/shared
for ORCA_UI_DIR in browser cache components constants diagnostics dictation \
  files hooks layout notifications platform session source-control storage \
  tasks terminal theme worktree
do
  rsync -a "$ORCA_SOURCE/mobile/src/$ORCA_UI_DIR/" \
    "mobile/src/orca/$ORCA_UI_DIR/"
done
rsync -a "$ORCA_SOURCE/mobile/app/h/" mobile/app/h/
cp "$ORCA_SOURCE/mobile/app/pair.tsx" mobile/app/pair.tsx
cp "$ORCA_SOURCE/mobile/app/pair-scan.tsx" mobile/app/pair-scan.tsx
cp "$ORCA_SOURCE/mobile/app/pair-confirm.tsx" mobile/app/pair-confirm.tsx
cp "$ORCA_SOURCE/mobile/app/about.tsx" mobile/app/about.tsx
cp "$ORCA_SOURCE/mobile/app/browser-settings.tsx" mobile/app/browser-settings.tsx
cp "$ORCA_SOURCE/mobile/app/terminal-settings.tsx" mobile/app/terminal-settings.tsx
cp "$ORCA_SOURCE/mobile/app/voice-settings.tsx" mobile/app/voice-settings.tsx
cp "$ORCA_SOURCE/mobile/app/troubleshoot.tsx" mobile/app/troubleshoot.tsx
cp "$ORCA_SOURCE/mobile/app/index.tsx" \
  mobile/src/orca/routes/OrcaHomeRoute.tsx
```

Then use `rg -n "src/" mobile/app/h mobile/app/pair*.tsx
mobile/src/orca/routes/OrcaHomeRoute.tsx` to enumerate every route import and
change those imports explicitly with `apply_patch`. The home copy exports
`OrcaHomeRoute` instead of a default Expo route.

- [x] **Step 3: Install only dependencies actually imported by the vendored tree**

Align compatible versions with the pinned Orca `mobile/package.json` using
`npx expo install`. Include xterm, clipboard, document picker, file system,
haptics, image picker/manipulator, network, build properties and required
syntax/terminal packages. Do not add `tweetnacl` because Symphony retains its
existing `@noble/*` handshake. Do not add the Orca two-way-audio package until
the voice screen is connected in Task 10.

Run:

```bash
cd mobile
npx expo install --fix
npx expo install --check
```

Expected: dependency versions are Expo 55 compatible.

- [x] **Step 4: Add an upstream-drift inventory**

Create `mobile/src/orca/upstream-manifest.test.ts` that verifies the pinned
commit in `ORCA_UPSTREAM.md` and asserts the presence of these representative
copied files:

```ts
const required = [
  "components/BottomDrawer.tsx",
  "components/WorktreeListRow.tsx",
  "files/MobileFileExplorerPanel.tsx",
  "session/TerminalPaneView.tsx",
  "source-control/MobileSourceControlPanel.tsx",
  "tasks/mobile-work-items.ts",
  "theme/mobile-theme.ts",
];
```

The test must fail if a foundational upstream file is silently omitted.

- [x] **Step 5: Run copied pure tests in bounded batches**

Run only tests for imported pure helpers:

```bash
cd mobile
npx vitest run \
  src/orca/layout/responsive-layout-metrics.test.ts \
  src/orca/files/file-tree.test.ts \
  src/orca/source-control/mobile-git-status.test.ts \
  src/orca/session/mobile-terminal-records.test.ts \
  src/orca/upstream-manifest.test.ts
```

Expected: PASS after import-path normalization.

- [x] **Step 6: Commit the mechanical import**

```bash
git add mobile/app mobile/src/orca mobile/package.json \
  mobile/package-lock.json mobile/tsconfig.json
git commit -m "feat(mobile): vendor production Orca interface"
```

The commit message body records the exact upstream hash and explicitly states
that Orca wire crypto and host persistence were excluded.

### Task 5: Provide One Shared Multi-Host Runtime and Orca Client Facade

**Files:**

- Create: `mobile/src/runtime/HostRuntimeProvider.tsx`
- Create: `mobile/src/runtime/HostRuntimeProvider.test.tsx`
- Create: `mobile/src/orca/transport/rpc-client.ts`
- Create: `mobile/src/orca/transport/rpc-client.test.ts`
- Create: `mobile/src/orca/transport/client-context.tsx`
- Create: `mobile/src/orca/transport/types.ts`
- Modify: `mobile/src/rpc/host-connection-manager.ts`
- Modify: `mobile/src/api/TrackerClientProvider.tsx`
- Modify: `mobile/app/_layout.tsx`

- [x] **Step 1: Write the failing facade contract test**

Create `mobile/src/orca/transport/rpc-client.test.ts`:

```ts
it("presents Symphony results with the response shape expected by Orca", async () => {
  const transport = fakeTransport({
    "status.get": { runtimeId: "host-a", version: "1" },
  });
  const client = createSymphonyOrcaRpcClient("host-a", transport, stateSource("online"));

  await expect(client.sendRequest("status.get")).resolves.toEqual({
    id: expect.any(String),
    ok: true,
    result: { runtimeId: "host-a", version: "1" },
    _meta: { runtimeId: "host-a" },
  });
});

it("returns Orca failure envelopes without exposing encrypted transport details", async () => {
  const transport = rejectingTransport(new RpcError("offline", "Host offline", true));
  const client = createSymphonyOrcaRpcClient("host-a", transport, stateSource("offline"));
  await expect(client.sendRequest("status.get")).resolves.toMatchObject({
    ok: false,
    error: { code: "offline", message: "Host offline" },
  });
});
```

- [x] **Step 2: Run the test and confirm failure**

Run:

```bash
cd mobile
npx vitest run src/orca/transport/rpc-client.test.ts
```

Expected: FAIL because the facade does not exist.

- [x] **Step 3: Implement the narrow Orca client contract**

`createSymphonyOrcaRpcClient` wraps `HostTransport`:

```ts
export function createSymphonyOrcaRpcClient(
  hostId: string,
  transport: HostTransport,
  state: OrcaConnectionStateSource,
): RpcClient {
  return {
    async sendRequest(method, params = {}, options = {}) {
      const id = createRequestId();
      try {
        const result = await transport.call(method, params, timeoutSignal(options.timeoutMs));
        return { id, ok: true, result, _meta: { runtimeId: hostId } };
      } catch (error) {
        return { id, ok: false, error: publicRpcError(error), _meta: { runtimeId: hostId } };
      }
    },
    subscribe(method, params, onData) {
      let disposed = false;
      let cleanup: (() => void) | null = null;
      void transport.subscribe(method, params, (payload) => {
        if (!disposed) onData(payload);
      }).then((boundCleanup) => {
        if (disposed) boundCleanup();
        else cleanup = boundCleanup;
      });
      return () => {
        disposed = true;
        cleanup?.();
      };
    },
    getState: state.getState,
    getReconnectAttempt: state.getReconnectAttempt,
    getLastConnectedAt: state.getLastConnectedAt,
    onStateChange: state.subscribe,
    notifyForeground: transport.reconnect,
    close: transport.deactivate,
    updateTerminalSubscriptionViewport: () => undefined,
  };
}
```

The facade retains the upstream `RpcClient` type. It does not implement another
WebSocket or cryptographic handshake.

- [x] **Step 4: Lift connection ownership above the two shells**

`HostRuntimeProvider` owns one `HostConnectionManager`, registers every RPC
profile after `ConnectionProvider` hydration and exposes:

```ts
type HostRuntimeContextValue = {
  selectedHostId: string | null;
  selectHost(hostId: string): Promise<void>;
  transport(hostId: string): HostTransport | null;
  state(hostId: string): HostRuntimeState;
  subscribe(hostId: string, listener: () => void): () => void;
};
```

Switching profiles calls `manager.select(hostId)` and deactivates old streams,
but does not destroy the stored host or duplicate credentials. Update
`TrackerClientProvider` to consume the selected transport instead of creating
its own manager.

- [x] **Step 5: Prove both shells share one transport**

Add a provider test that mounts one Orca consumer and one Codex tracker client,
selects `host-a`, and asserts the injected `createTransport` ran once. Change
view mode and assert it still ran once.

Run:

```bash
cd mobile
npx vitest run src/orca/transport/rpc-client.test.ts
npx jest src/runtime/HostRuntimeProvider.test.tsx \
  src/api/TrackerClientProvider.test.tsx --runInBand
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add mobile/src/runtime mobile/src/orca/transport \
  mobile/src/rpc/host-connection-manager.ts \
  mobile/src/api/TrackerClientProvider.tsx mobile/app/_layout.tsx
git commit -m "feat(mobile): share Symphony host runtime across interfaces"
```

### Task 6: Copy Orca Onboarding and Connect Its Host Dashboard to Symphony RPC

**Files:**

- Create: `mobile/src/orca/transport/pairing.ts`
- Create: `mobile/src/orca/transport/pair-confirm-state.ts`
- Create: `mobile/src/orca/transport/host-store.ts`
- Modify: `mobile/app/pair.tsx`
- Modify: `mobile/app/pair-scan.tsx`
- Modify: `mobile/app/pair-confirm.tsx`
- Modify: `mobile/src/orca/routes/OrcaHomeRoute.tsx`
- Modify: `mobile/app/h/[hostId]/index.tsx`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/orca_system.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/orca_workspaces.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/orca_presenter.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/orca_system_test.exs`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/orca_workspaces_test.exs`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/dispatcher.ex`
- Modify: `docs/superpowers/specs/fixtures/mobile-rpc-capabilities-v1.json`

- [ ] **Step 1: Write failing host compatibility tests**

Add focused ExUnit cases asserting these allowlisted methods and result keys:

```elixir
test "Orca home methods present Symphony host state", %{dispatcher: dispatcher} do
  assert_rpc(dispatcher, "status.get", %{}, %{
    "runtimeId" => "host-a",
    "product" => "Symphony"
  })
  assert_rpc(dispatcher, "repo.list", %{}, %{"repos" => [_ | _]})
  assert_rpc(dispatcher, "worktree.ps", %{}, %{"worktrees" => [_ | _]})
end
```

Cover:

```text
status.get
settings.get
settings.update
preflight.check
preflight.detectAgents
preflight.detectRemoteAgents
stats.summary
accounts.list
accounts.subscribe
repo.list
repo.hooks
repo.searchRefs
repo.baseRefDefault
repo.sparsePresets
repo.saveSparsePreset
ui.get
ui.set
worktree.ps
worktree.show
worktree.create
worktree.activate
worktree.set
worktree.sleep
worktree.rm
```

- [ ] **Step 2: Run the focused server tests and confirm method rejection**

Run:

```bash
cd elixir
mix test \
  test/symphony_elixir/mobile_rpc/methods/orca_system_test.exs \
  test/symphony_elixir/mobile_rpc/methods/orca_workspaces_test.exs
```

Expected: FAIL with `method_not_allowed`.

- [ ] **Step 3: Implement allowlisted presenters over existing services**

`OrcaSystem` and `OrcaWorkspaces` register one method module per exact upstream
name. Each validator accepts only documented keys. Calls delegate to existing
Symphony contexts/bridges and `OrcaPresenter`; they never execute arbitrary
paths or methods supplied by the phone.

The presenter returns stable upstream field names while retaining Symphony
identities:

```elixir
def present_host(identity, capabilities) do
  %{
    "runtimeId" => identity.host_id,
    "product" => "Symphony",
    "displayName" => identity.name,
    "version" => identity.version,
    "capabilities" => capabilities
  }
end
```

- [ ] **Step 4: Adapt the copied pairing flow without changing its layout**

`pairing.ts` re-exports `parsePairingOffer` semantics for
`symphony://pair?code=...`. `host-store.ts` adapts copied calls to
`ConnectionProvider` storage and never writes the device token to
AsyncStorage. `pair-confirm.tsx` keeps Orca's explicit confirmation,
connection log and timeout, but the visible copy is:

```text
Pair with this Symphony host?
Dev10x will connect directly to this machine.
```

The profile is saved only after the encrypted handshake and `status.get`
succeed.

- [ ] **Step 5: Run focused mobile and server tests**

Run:

```bash
cd mobile
npx vitest run \
  src/auth/pairing-offer.test.ts \
  src/orca/transport/pair-confirm-state.test.ts \
  src/orca/transport/rpc-client.test.ts
cd ../elixir
mix test \
  test/symphony_elixir/mobile_rpc/methods/orca_system_test.exs \
  test/symphony_elixir/mobile_rpc/methods/orca_workspaces_test.exs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/app mobile/src/orca/transport mobile/src/orca/routes \
  elixir/lib/symphony_elixir/mobile_rpc \
  elixir/test/symphony_elixir/mobile_rpc \
  docs/superpowers/specs/fixtures/mobile-rpc-capabilities-v1.json
git commit -m "feat(mobile): connect Orca onboarding to Symphony hosts"
```

### Task 7: Connect the Copied Session and Terminal Experience

**Files:**

- Modify: `mobile/app/h/[hostId]/session/[worktreeId].tsx`
- Modify: `mobile/src/orca/session/**`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/orca_sessions.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/orca_subscription.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/orca_sessions_test.exs`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/methods/terminal.ex`
- Modify: `elixir/test/symphony_elixir/mobile_rpc/session_bridge_test.exs`
- Modify: `mobile/scripts/mock-server-rpc-handlers.ts`
- Modify: `mobile/src/rpc/mock-server-rpc-handlers.test.ts`

- [ ] **Step 1: Write failing RPC compatibility tests**

Cover the exact copied calls:

```text
session.tabs.list
session.tabs.subscribe
session.tabs.activate
session.tabs.createTerminal
session.tabs.close
terminal.list
terminal.subscribe
terminal.send
terminal.updateViewport
terminal.focus
terminal.rename
terminal.close
terminal.clearBuffer
terminal.setDisplayMode
terminal.getAutoRestoreFit
terminal.setAutoRestoreFit
markdown.readTab
markdown.saveTab
```

Assert `session.tabs.subscribe` activates only after the subscription result is
encrypted and emits ordered `session.tabs.snapshot` / delta events. Assert
terminal streams remain scoped to the authenticated selected host.

- [ ] **Step 2: Run focused failing tests**

Run:

```bash
cd elixir
mix test \
  test/symphony_elixir/mobile_rpc/methods/orca_sessions_test.exs \
  test/symphony_elixir/mobile_rpc/session_bridge_test.exs
```

Expected: FAIL for missing Orca-compatible method modules.

- [ ] **Step 3: Add compatibility handlers over existing session bridges**

Map copied tab/session operations onto `SessionBridge`,
`TerminalBridge` and shared session services. Preserve upstream result shapes,
including handles, titles, agent kind, active tab and terminal dimensions.
Do not add a second session store.

- [ ] **Step 4: Keep copied session presentation intact**

Change only its transport imports, Dev10x/Symphony copy and capability gates.
The terminal WebView, dock, tab strip, input actions, agent state, approval and
question experiences remain copied from Orca.

- [ ] **Step 5: Add matching mock handlers**

The external mock implements the same method names and emits deterministic
session/terminal snapshots through the normal encrypted transport. It does not
branch on a mock flag in React code.

- [ ] **Step 6: Run bounded validation**

Run:

```bash
cd mobile
npx vitest run \
  src/orca/session/opened-mobile-session-tab.test.ts \
  src/orca/session/mobile-terminal-records.test.ts \
  src/rpc/mock-server-rpc-handlers.test.ts
npm run typecheck
cd ../elixir
mix test test/symphony_elixir/mobile_rpc/methods/orca_sessions_test.exs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/app/h mobile/src/orca/session mobile/scripts \
  mobile/src/rpc/mock-server-rpc-handlers.test.ts \
  elixir/lib/symphony_elixir/mobile_rpc \
  elixir/test/symphony_elixir/mobile_rpc
git commit -m "feat(mobile): connect Orca sessions and terminal to Symphony"
```

### Task 8: Connect Files, Markdown, Browser and Preview

**Files:**

- Modify: `mobile/app/h/[hostId]/files/[worktreeId].tsx`
- Modify: `mobile/app/h/[hostId]/files/preview/[worktreeId].tsx`
- Modify: `mobile/src/orca/files/**`
- Modify: `mobile/src/orca/browser/**`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/orca_files.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/orca_files_test.exs`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/methods/workspace.ex`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/methods/previews.ex`
- Modify: `mobile/scripts/mock-server-file-preview-data.ts`
- Modify: `mobile/scripts/mock-server-rpc-handlers.ts`

- [ ] **Step 1: Write failing method-shape tests**

Cover:

```text
files.list
files.readDir
files.read
files.readPreview
files.open
files.openDiff
files.resolveTerminalPath
files.writeTerminalArtifact
browser.screencast
browser.mouseDown
browser.mouseMove
browser.mouseUp
browser.mouseWheel
clipboard.startImageUpload
clipboard.appendImageUploadChunk
clipboard.commitImageUpload
clipboard.abortImageUpload
clipboard.saveImageAsTempFile
```

Validate every path through the existing workspace sandbox and cap upload/read
sizes before allocation.

- [ ] **Step 2: Run tests and confirm missing methods**

Run:

```bash
cd elixir
mix test test/symphony_elixir/mobile_rpc/methods/orca_files_test.exs
```

Expected: FAIL with method rejection.

- [ ] **Step 3: Implement handlers and copied UI transport wiring**

Use existing workspace and preview services. Return upstream file tree,
preview, syntax and artifact shapes through `OrcaPresenter`. Browser
screencast controls are capability-gated; if the selected host does not
advertise them, the copied upstream unavailable state renders.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd mobile
npx vitest run \
  src/orca/files/file-tree.test.ts \
  src/orca/files/mobile-file-preview-request.test.ts \
  src/orca/browser/browser-touch-geometry.test.ts
cd ../elixir
mix test test/symphony_elixir/mobile_rpc/methods/orca_files_test.exs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/h mobile/src/orca/files mobile/src/orca/browser \
  mobile/scripts elixir/lib/symphony_elixir/mobile_rpc \
  elixir/test/symphony_elixir/mobile_rpc
git commit -m "feat(mobile): connect Orca files and previews to Symphony"
```

### Task 9: Connect Source Control, History, Pull Requests and Review

**Files:**

- Modify: `mobile/app/h/[hostId]/source-control/[worktreeId].tsx`
- Modify: `mobile/app/h/[hostId]/history/[worktreeId].tsx`
- Modify: `mobile/app/h/[hostId]/pr/[worktreeId].tsx`
- Modify: `mobile/app/h/[hostId]/review/[worktreeId].tsx`
- Modify: `mobile/src/orca/source-control/**`
- Modify: `mobile/src/orca/components/pr-sidebar/**`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/orca_git.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/orca_git_test.exs`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/methods/git.ex`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/methods/pull_requests.ex`
- Modify: `mobile/scripts/mock-server-git-state.ts`
- Modify: `mobile/scripts/mock-server-rpc-handlers.ts`

- [ ] **Step 1: Write failing compatibility tests**

Cover:

```text
git.status
git.diff
git.branchDiff
git.branchCompare
git.commitCompare
git.history
git.stage
git.commit
git.push
git.generateCommitMessage
git.cancelGenerateCommitMessage
git.generatePullRequestFields
hostedReview.getCreationEligibility
```

Tests must prove repository/workspace scoping, staged/unstaged separation,
commit idempotency, push/PR error normalization and no arbitrary command
execution.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd elixir
mix test test/symphony_elixir/mobile_rpc/methods/orca_git_test.exs
```

Expected: FAIL for missing methods.

- [ ] **Step 3: Add presenters over existing Git and PR services**

Return the shapes already consumed by Orca's Source Control and PR components.
Keep upstream controls, drawers, staged/unstaged groups, history, review and
failure recovery. Capability-gate only operations genuinely unavailable from
the selected Symphony host.

- [ ] **Step 4: Run focused mobile and server tests**

Run:

```bash
cd mobile
npx vitest run \
  src/orca/source-control/mobile-git-status.test.ts \
  src/orca/source-control/mobile-git-history.test.ts \
  src/orca/source-control/mobile-source-control-actions.test.ts \
  src/orca/components/pr-sidebar/pr-actions-state.test.ts
cd ../elixir
mix test test/symphony_elixir/mobile_rpc/methods/orca_git_test.exs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/h mobile/src/orca/source-control \
  mobile/src/orca/components/pr-sidebar mobile/scripts \
  elixir/lib/symphony_elixir/mobile_rpc \
  elixir/test/symphony_elixir/mobile_rpc
git commit -m "feat(mobile): connect Orca source control to Symphony"
```

### Task 10: Preserve Orca Tasks, Accounts, Notifications, Diagnostics and Voice

**Files:**

- Modify: `mobile/app/h/[hostId]/tasks.tsx`
- Modify: `mobile/app/h/[hostId]/accounts.tsx`
- Modify: `mobile/app/notifications.tsx`
- Modify: `mobile/app/troubleshoot.tsx`
- Modify: `mobile/app/voice-settings.tsx`
- Modify: `mobile/src/orca/tasks/**`
- Modify: `mobile/src/orca/notifications/**`
- Modify: `mobile/src/orca/diagnostics/**`
- Modify: `mobile/src/orca/dictation/**`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/orca_tasks.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/orca_tasks_test.exs`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/methods/tasks.ex`
- Modify: `elixir/lib/symphony_elixir/mobile_rpc/methods/notifications.ex`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [ ] **Step 1: Write failing Symphony-domain extension tests**

Assert copied task surfaces receive Symphony projects, issues, blockers,
subtasks, comments and agent state without fabricating GitHub/Linear data.
Cover native Symphony RPC operations plus capability-gated upstream providers:

```text
github.listWorkItems
github.project.listAccessible
github.project.listViews
github.project.resolveRef
linear.status
linear.listIssues
linear.listTeams
linear.searchIssues
linear.teamStates
linear.createIssue
linear.updateIssue
linear.selectWorkspace
gitlab.listWorkItems
gitlab.todos
gitlab.updateIssue
gitlab.updateMRState
notifications.subscribe
notifications.unsubscribe
speech.dictation.setup
speech.dictation.start
speech.dictation.chunk
speech.dictation.cancel
speech.models.list
speech.models.download
speech.models.delete
```

Only advertise provider/voice methods backed by the selected host. Unavailable
providers retain the copied Orca hidden or disabled state.

- [ ] **Step 2: Run focused failing tests**

Run:

```bash
cd elixir
mix test test/symphony_elixir/mobile_rpc/methods/orca_tasks_test.exs
```

Expected: FAIL for missing compatibility methods.

- [ ] **Step 3: Connect Symphony-specific task and agent data**

Extend copied Orca rows and drawers through existing component patterns.
Include task identifier, status, blockers, subtasks, selected agent, approval
and pending-question indicators. Do not replace the copied host/workspace
hierarchy with the old Codex session list.

- [ ] **Step 4: Retain upstream notification and diagnostic behavior**

Route notification payloads by `host_id`; redact device tokens, pair codes,
session keys and plaintext RPC bodies from connection logs and exports.
Install the copied two-way audio module only if its Expo 55 Android build
passes a focused native compile; otherwise keep voice controls capability-
disabled with the upstream unavailable state and record the missing host
capability in the matrix.

- [ ] **Step 5: Run focused validation**

Run:

```bash
cd mobile
npx vitest run \
  src/orca/tasks/mobile-work-items.test.ts \
  src/orca/notifications/mobile-notifications.test.ts \
  src/orca/diagnostics/host-reachability.test.ts \
  src/orca/dictation/mobile-dictation-setup.test.ts
cd ../elixir
mix test test/symphony_elixir/mobile_rpc/methods/orca_tasks_test.exs
```

Expected: PASS; unsupported provider controls are capability-disabled rather
than backed by fixtures in production.

- [ ] **Step 6: Commit**

```bash
git add mobile/app mobile/src/orca mobile/package.json mobile/package-lock.json \
  elixir/lib/symphony_elixir/mobile_rpc \
  elixir/test/symphony_elixir/mobile_rpc
git commit -m "feat(mobile): expose Symphony tasks in the Orca experience"
```

### Task 11: Preserve the Existing Codex Interface as the Alternate View

**Files:**

- Create: `mobile/app/codex/index.tsx`
- Create: `mobile/app/codex/settings.tsx`
- Create: `mobile/app/codex/session/[threadId].tsx`
- Create: `mobile/app/codex/session/[threadId]/{diff,files,preview,terminal}.tsx`
- Create: `mobile/app/codex/issue/[projectSlug]/[identifier].tsx`
- Create: `mobile/app/codex/issue/[projectSlug]/[identifier]/pull-request.tsx`
- Create: `mobile/app/codex/tasks.tsx`
- Create: `mobile/app/codex/tasks/new.tsx`
- Modify: `mobile/src/native/notifications.ts`
- Modify: `mobile/app/index.tsx`
- Test: `mobile/src/preferences/view-routing.test.ts`

- [ ] **Step 1: Write the failing semantic route test**

```ts
it("maps the same session target into the active device view", () => {
  const target = { hostId: "host-a", kind: "session" as const, id: "42" };
  expect(routeForView("orca", target)).toBe("/h/host-a/session/42");
  expect(routeForView("codex", target)).toBe("/codex/session/42");
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
cd mobile
npx vitest run src/preferences/view-routing.test.ts
```

Expected: FAIL because `routeForView` does not exist.

- [ ] **Step 3: Move only route entry points, not shared data**

The new `/codex` routes import the existing `src/features/**` screens. They do
not instantiate `ConnectionProvider`, `TrackerClientProvider` or a second
query cache. Root notifications resolve a semantic target, then call
`routeForView(currentMode, target)`.

- [ ] **Step 4: Prove view changes preserve host state**

Add a provider test:

```ts
expect(runtime.selectedHostId).toBe("host-a");
await viewMode.setMode("codex");
expect(runtime.selectedHostId).toBe("host-a");
expect(createTransport).toHaveBeenCalledTimes(1);
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd mobile
npx vitest run src/preferences/view-routing.test.ts
npx jest src/preferences/ViewModeProvider.test.tsx \
  src/features/sessions/SessionLibraryRoute.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/codex mobile/app/index.tsx \
  mobile/src/preferences mobile/src/native/notifications.ts
git commit -m "feat(mobile): retain compact Codex interface as an option"
```

### Task 12: Bring the Mock Server to the Same Orca-Compatible RPC Surface

**Files:**

- Modify: `mobile/scripts/mock-server.ts`
- Modify: `mobile/scripts/mock-server-encryption.ts`
- Modify: `mobile/scripts/mock-server-rpc-handlers.ts`
- Create: `mobile/scripts/mock-server-file-preview-data.ts`
- Create: `mobile/scripts/mock-server-git-state.ts`
- Create: `mobile/scripts/mock-server-terminal-fixtures.ts`
- Modify: `mobile/src/rpc/mock-server-interop.test.ts`
- Modify: `mobile/src/rpc/mock-server-rpc-handlers.test.ts`
- Modify: `mobile/e2e/mock-server-smoke.sh`

- [ ] **Step 1: Write a failing compatibility smoke assertion**

Extend `mock-server-interop.test.ts` to pair through the production Symphony
handshake and call:

```ts
for (const method of [
  "status.get",
  "repo.list",
  "worktree.ps",
  "session.tabs.list",
  "terminal.list",
  "files.readDir",
  "git.status",
]) {
  const response = await orcaClient.sendRequest(method, paramsFor(method));
  expect(response.ok).toBe(true);
}
```

- [ ] **Step 2: Run and confirm missing methods**

Run:

```bash
cd mobile
npx vitest run src/rpc/mock-server-interop.test.ts \
  src/rpc/mock-server-rpc-handlers.test.ts
```

Expected: FAIL for newly required Orca-compatible methods.

- [ ] **Step 3: Copy Orca's server fixture boundaries**

Retain the current Symphony handshake and frame encryption. Copy Orca's
separate file-preview, Git-state and terminal-fixture modules and adapt their
method outputs to the same presenters used by the copied frontend. Preserve
latency, forced-method-error, disconnect and reconnect environment controls.

- [ ] **Step 4: Prove the app has no mock-only branch**

Run:

```bash
rg -n "EXPO_PUBLIC_E2E_FIXTURES|fixtureMode|createFixtureRuntime" \
  mobile/app mobile/src
```

Expected: no fixture-mode application runtime. The external mock is selected
only by pairing its endpoint.

- [ ] **Step 5: Run the focused smoke**

Run:

```bash
cd mobile
npx vitest run src/rpc/mock-server-interop.test.ts \
  src/rpc/mock-server-rpc-handlers.test.ts
bash e2e/mock-server-smoke.sh
```

Expected: PASS, labeled `backend: mock`.

- [ ] **Step 6: Commit**

```bash
git add mobile/scripts mobile/src/rpc mobile/e2e/mock-server-smoke.sh
git commit -m "test(mobile): mirror Orca mock server coverage"
```

### Task 13: Enforce Dev10x Branding and Upstream Behavioral Integrity

**Files:**

- Create: `mobile/src/brand/visible-copy.test.ts`
- Modify: copied `mobile/app/**` and `mobile/src/orca/**` visible strings
- Modify: `mobile/src/orca/components/OrcaLogo.tsx` and rename to
  `mobile/src/orca/components/Dev10xLogo.tsx`
- Modify: `mobile/app.config.ts`
- Modify: `mobile/assets/**`

- [ ] **Step 1: Write a visible-copy regression test**

Scan route and component source while excluding provenance/license files:

```ts
const forbiddenVisibleCopy = [
  /["'`]Orca["'`]/,
  /orca:\/\/pair/,
  /Pair Desktop/,
  /Orca Mobile/,
  /marine creature/i,
];
```

Assert `APP_BRAND === "Dev10x"`, Expo display name is Dev10x, pairing scheme is
`symphony`, and permission messages begin with `Allow Dev10x`.

- [ ] **Step 2: Run and confirm copied branding fails**

Run:

```bash
cd mobile
npx vitest run src/brand/visible-copy.test.ts
```

Expected: FAIL listing copied user-visible Orca strings.

- [ ] **Step 3: Replace branding without redesigning screens**

Replace logo components/assets and rewrite messages for Dev10x and Symphony
host terminology. Keep layout, spacing, colors, animation, accessibility roles,
confirmation order and recovery actions unchanged.

- [ ] **Step 4: Compare representative copied files with upstream**

Run:

```bash
git diff --no-index \
  /home/raphaelcangucu/orca/mobile/src/components/BottomDrawer.tsx \
  mobile/src/orca/components/BottomDrawer.tsx
git diff --no-index \
  /home/raphaelcangucu/orca/mobile/src/files/MobileFileExplorerPanel.tsx \
  mobile/src/orca/files/MobileFileExplorerPanel.tsx
```

Expected: no differences except import roots, formatting forced by this repo,
Dev10x/Symphony copy or capability injection.

- [ ] **Step 5: Run focused brand and copied-component tests**

Run:

```bash
cd mobile
npx vitest run src/brand/dev10x-brand.test.ts \
  src/brand/visible-copy.test.ts \
  src/orca/upstream-manifest.test.ts \
  src/orca/components/MobileMarkdown.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/app.config.ts mobile/app mobile/assets \
  mobile/src/brand mobile/src/orca
git commit -m "fix(mobile): apply Dev10x brand across copied Orca flows"
```

### Task 14: Run Bounded Local Validation and Build the Android APK

**Files:**

- Modify only files required by validation failures.
- Produce ignored artifacts under `mobile/artifacts/e2e/`.

- [ ] **Step 1: Run formatting, lint and type-check**

Run:

```bash
cd mobile
npm run format:check
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run only the focused cross-layer tests used by this plan**

Run the exact Vitest/Jest/ExUnit files named in Tasks 2–13. Do not replace them
with `npm test`, `mix test` without paths or `make-all`.

Expected: all focused tests pass.

- [ ] **Step 3: Build the local Android release APK**

Run:

```bash
cd mobile
npm run build:android:release
sha256sum android/app/build/outputs/apk/release/app-release.apk
```

Expected: release APK for `arm64-v8a` and a recorded SHA-256. If emulator E2E
requires x86_64, run the existing bounded E2E build script once; do not build
all architectures.

- [ ] **Step 4: Install and smoke the default brand**

Run:

```bash
adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk
adb shell monkey -p dev.dev10x.symphony 1
```

Expected: launcher/splash/app identity is Dev10x and the first screen is the
copied Orca onboarding/home experience.

- [ ] **Step 5: Commit validation fixes**

Commit only source fixes; do not commit APKs, videos, traces or pairing
secrets.

### Task 15: Record Real Two-Host E2E, Update the Gist and PR

**Files:**

- Modify: `mobile/e2e/multi-host-smoke.sh`
- Create ignored:
  `mobile/artifacts/e2e/dev10x-orca-first-real-host-e2e.mp4`
- Create ignored:
  `mobile/artifacts/e2e/dev10x-orca-first-real-host-contact-sheet.png`
- Create ignored:
  `mobile/artifacts/e2e/dev10x-orca-first-real-host-report.md`
- Modify PR description through GitHub after local evidence passes.

- [ ] **Step 1: Start two real local Symphony hosts**

Use separate ports, databases, host identities, projects and workspaces. Create
distinct per-device pairing offers. Never print or persist pairing secrets in
the report, trace or video.

Expected: both `/mobile/rpc` endpoints answer independently and advertise
different `host_id` values.

- [ ] **Step 2: Run the complete real-host Android journey**

The automated journey must show:

1. Dev10x first-run onboarding;
2. QR/deep-link pair confirmation for host A;
3. host A dashboard and project/workspace;
4. session/chat/agent activity, approval and question;
5. terminal, file preview and source control;
6. PR/review when supported by the local repository;
7. pairing and switching to host B;
8. host B state isolation and offline/reconnect state;
9. switch to the Compact Sessions (Codex) view;
10. same selected host and session data;
11. switch back to Dev10x Workspace without a second connection.

- [ ] **Step 3: Validate the recording**

Run:

```bash
ffprobe -v error -show_entries format=duration \
  -show_entries stream=codec_name,width,height \
  -of json mobile/artifacts/e2e/dev10x-orca-first-real-host-e2e.mp4
sha256sum mobile/artifacts/e2e/dev10x-orca-first-real-host-e2e.mp4
```

Expected: H.264 video, portrait dimensions, non-zero duration and a recorded
SHA-256. Generate and visually inspect a contact sheet before publishing.

- [ ] **Step 4: Update the existing Gist**

Replace the old walkthrough files in Gist
`89652c626c9583cb9b0c52d8d5b2a708` with the new MP4, contact sheet, redacted
trace and report. Verify each raw URL returns the new SHA/content.

- [ ] **Step 5: Update and push the PR**

Run focused final checks, push the branch normally, and update PR #7 with:

- Dev10x as the explicit primary brand;
- pinned Orca source and MIT attribution;
- latest `origin/main` merge commit;
- architecture and capability summary;
- real-host E2E video/contact-sheet links and SHA;
- mock-server scope labeled development-only;
- Android APK SHA;
- iOS validation remaining for the user's Mac.

Expected: PR body validation passes and GitHub shows the new branch head.

### Task 16: Prepare the macOS/iOS Handoff

**Files:**

- Create: `mobile/docs/ios-real-host-e2e.md`
- Modify: PR #7 description with the eventual iOS result.

- [ ] **Step 1: Document exact Mac commands**

Include Node/Xcode prerequisites, dependency install, CocoaPods/Expo prebuild,
`npm run ios`, pairing with a reachable Symphony host, log redaction and the
same semantic E2E checkpoints used on Android.

- [ ] **Step 2: Add an iOS evidence checklist**

The checklist covers QR permission, SecureStore/Keychain, background/foreground
reconnect, notification routing, terminal keyboard, file preview, Source
Control, interface switching and tablet layout.

- [ ] **Step 3: Run documentation checks and commit**

Run:

```bash
git diff --check
git add mobile/docs/ios-real-host-e2e.md
git commit -m "docs(mobile): add Dev10x iOS real-host handoff"
```

Expected: a Mac-ready handoff without claiming iOS passed before it is run.

## Final Acceptance Gate

The PR is ready for the user's Mac validation only when all statements below
are true:

- latest `origin/main` is in the feature branch ancestry;
- Dev10x is the only primary visible app brand;
- Orca MIT provenance is preserved;
- copied Orca production screens are the default experience;
- Codex Compact Sessions is a global device option using the same runtime;
- two real local Symphony hosts pair, switch and remain isolated over E2EE RPC;
- the mock server uses the same production client but is not acceptance proof;
- focused tests, Android APK build and the real-host E2E recording pass;
- PR #7 and the existing Gist contain the new evidence and accurate limitations.
