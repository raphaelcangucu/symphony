# Symphony Mobile Multi-Host RPC Implementation Plan

**Goal:** Replace the shared-token, tracker-centric mobile connection with direct pairing and encrypted control of multiple independent Symphony hosts.

**Architecture:** Every Symphony host exposes an in-process raw WebSocket RPC gateway backed by existing application services. New mobile profiles pin one host identity, authenticate with a revocable per-device credential inside an X25519/HKDF/ChaCha20-Poly1305 channel, and route every request, stream, cache and notification through the selected host. REST and Phoenix remain a compatibility adapter during method-by-method migration.

**Tech Stack:** Elixir/OTP `:crypto`, Phoenix 1.8, WebSock/WebSockAdapter, Ecto/SQLite, Expo SDK 55, React Native 0.83, Expo SecureStore/Crypto/Camera, TanStack Query, `@noble/curves`, `@noble/hashes`, `@noble/ciphers`, Vitest, Jest, GitHub Actions, Android/iOS E2E.

---

## Execution Rules

- This plan is mandatory scope for the current mobile PR.
- Preserve the approved clean Codex-style session hierarchy.
- Do not run ExUnit integration suites, Expo prebuild, Gradle/Xcode builds,
  emulators, Maestro or video capture in WSL.
- WSL may run focused Vitest/Jest tests, TypeScript checks, lint and formatting.
- Run Elixir tests and every native/heavy job in GitHub Actions or a dedicated
  native runner.
- Use TDD for each task and commit after its focused evidence is green.
- Never log raw pairing offers, device tokens, host private keys, session keys,
  plaintext encrypted frames, push tokens or authorization headers.

### Task 1: Cross-language crypto contract

**Files:**

- Create: `docs/superpowers/specs/fixtures/mobile-rpc-crypto-v1.json`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/crypto.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/crypto_test.exs`
- Create: `mobile/src/rpc/crypto.ts`
- Create: `mobile/src/rpc/crypto.test.ts`
- Modify: `mobile/package.json`

- [x] **Step 1: Add fixed interoperability vectors**

Define one deterministic X25519 shared secret, transcript hash, HKDF salt/info,
directional keys, nonce, AAD, plaintext, ciphertext and tag. The fixture must
contain public inputs and test-only private keys, never production material.

```json
{
  "version": 1,
  "suite": "X25519-HKDF-SHA256-CHACHA20POLY1305",
  "client_to_host": {
    "sequence": 1,
    "plaintext_utf8": "{\"type\":\"auth\",\"device_id\":\"device_test\"}"
  }
}
```

- [x] **Step 2: Write failing Elixir and TypeScript vector tests**

The Elixir and mobile implementations must derive exactly the same bytes,
decrypt each other's frame, reject a changed tag/AAD and reject replayed
sequence numbers.

- [x] **Step 3: Verify RED in safe environments**

Run in WSL:

```bash
cd mobile
node_modules/.bin/vitest run src/rpc/crypto.test.ts --maxWorkers=2
```

Expected: FAIL because `src/rpc/crypto.ts` does not exist.

Run the focused Elixir test only in CI:

```bash
cd elixir
mix test test/symphony_elixir/mobile_rpc/crypto_test.exs
```

- [x] **Step 4: Implement the crypto providers**

Mobile uses Expo Crypto for random bytes and the pinned Noble packages for
X25519, HKDF-SHA-256 and ChaCha20-Poly1305. Elixir uses OTP `:crypto` for the
same primitives.

```ts
export interface SessionCipher {
  encrypt(direction: "c2h" | "h2c", sequence: bigint, plaintext: Uint8Array): Uint8Array;
  decrypt(direction: "c2h" | "h2c", sequence: bigint, frame: Uint8Array): Uint8Array;
}
```

```elixir
@spec derive_session(binary(), binary(), binary()) ::
        {:ok, %{client_to_host: binary(), host_to_client: binary()}}
def derive_session(shared_secret, transcript_hash, salt)
```

- [x] **Step 5: Verify GREEN and commit**

Run the mobile vector test, typecheck and format in WSL; run the Elixir vector
test in CI.

Commit: `feat(mobile-rpc): add interoperable encrypted frame contract`

### Task 2: Host identity, device registry and pairing offers

**Files:**

- Create: `elixir/priv/repo/migrations/*_create_mobile_rpc_identity_and_devices.exs`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/host_identity.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/device.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/devices.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/pairing_offer.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/devices_test.exs`
- Create: `elixir/test/symphony_elixir/mobile_rpc/pairing_offer_test.exs`
- Create: `mobile/src/auth/pairing-offer.ts`
- Create: `mobile/src/auth/pairing-offer.test.ts`

- [x] **Step 1: Write failing registry and parser tests**

Prove singleton host identity persistence, distinct tokens, keyed token digests,
constant-time validation, pending-offer rotation, first-seen activation,
individual revocation, strict deep-link route/version/scope validation and
secret redaction.

```ts
export type PairingOfferV1 = {
  v: 1;
  endpoint: string;
  hostId: string;
  hostName: string;
  hostPublicKey: string;
  deviceId: string;
  deviceToken: string;
  scope: "mobile";
  protocolMin: 1;
  protocolMax: 1;
};
```

- [x] **Step 2: Verify RED**

Run the focused mobile parser test in WSL. Run registry tests in CI.

- [x] **Step 3: Implement persistence and offer generation**

Store the host private key encrypted through `Settings.Vault`; store only a
keyed token digest in `mobile_rpc_devices`. A generated unused offer is pending,
and regeneration revokes the previous pending row.

- [x] **Step 4: Verify GREEN and commit**

Commit: `feat(mobile-rpc): add host identity and device pairing`

### Task 3: Raw WebSocket encrypted handshake

**Files:**

- Create: `elixir/lib/symphony_elixir_web/mobile_rpc_upgrade_plug.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/socket.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/handshake.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/handshake_test.exs`
- Create: `elixir/test/symphony_elixir_web/mobile_rpc_socket_test.exs`
- Modify: `elixir/lib/symphony_elixir_web/endpoint.ex`
- Create: `mobile/src/rpc/handshake.ts`
- Create: `mobile/src/rpc/handshake.test.ts`
- Create: `mobile/src/rpc/websocket-adapter.ts`

- [x] **Step 1: Write failing handshake state-machine tests**

Cover valid negotiation, no common version, wrong host id, malformed keys,
plaintext auth rejection, invalid/revoked token, transcript mismatch, timeout,
tag failure, replay and successful encrypted authentication.

```ts
export type HandshakeState =
  | "connecting"
  | "handshaking"
  | "authenticating"
  | "online"
  | "revoked"
  | "host_key_mismatch"
  | "protocol_incompatible";
```

- [x] **Step 2: Verify RED**

Run only `mobile/src/rpc/handshake.test.ts` in WSL. Run WebSock integration in
CI.

- [x] **Step 3: Implement `/mobile/rpc`**

Use `WebSockAdapter` to upgrade one raw WebSocket. Accept no query-string
credential. The socket may process only `hello` before key derivation and only
encrypted `auth` before it reaches `ready`.

```elixir
@impl WebSock
def handle_in({frame, opcode: :text}, %{phase: :awaiting_hello} = state)

@impl WebSock
def handle_in({frame, opcode: :binary}, %{phase: :awaiting_auth} = state)
```

- [x] **Step 4: Add connection supervision and cleanup**

Track sockets by `device_id`, terminate all of one device on revocation, clear
session keys and subscriptions on disconnect, and rate-limit pairing/auth
failures.

- [x] **Step 5: Verify GREEN and commit**

Commit: `feat(mobile-rpc): add encrypted websocket handshake`

### Task 4: Versioned dispatcher, heartbeat and system RPC

**Files:**

- Create: `elixir/lib/symphony_elixir/mobile_rpc/envelope.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/dispatcher.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/method.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/system.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/subscriptions.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/dispatcher_test.exs`
- Create: `mobile/src/rpc/contracts.ts`
- Create: `mobile/src/rpc/client.ts`
- Create: `mobile/src/rpc/client.test.ts`

- [x] **Step 1: Write failing envelope and dispatcher tests**

Prove unique ids, schema validation, mobile allowlist, per-method timeout,
structured errors, concurrency limits, heartbeat, cancellation, subscription
cleanup and redacted diagnostics.

```elixir
defmodule SymphonyElixir.MobileRpc.Method do
  @callback name() :: String.t()
  @callback scope() :: :mobile
  @callback validate(map()) :: {:ok, map()} | {:error, term()}
  @callback call(map(), map()) :: {:ok, term()} | {:error, term()}
end
```

- [x] **Step 2: Verify RED**

Run the mobile RPC client test in WSL and dispatcher tests in CI.

- [x] **Step 3: Implement `system.*`**

Add `system.identity`, `system.health`, `system.capabilities`,
`system.heartbeat`, `system.usage` and `devices.self_revoke`. Every response
contains `host_id`, negotiated protocol and server timestamp metadata.

- [x] **Step 4: Verify GREEN and commit**

Commit: `feat(mobile-rpc): add versioned dispatcher and host health`

### Task 5: Transport abstraction and legacy compatibility

**Files:**

- Create: `mobile/src/transport/HostTransport.ts`
- Create: `mobile/src/transport/RpcHostTransport.ts`
- Create: `mobile/src/transport/LegacyHostTransport.ts`
- Create: `mobile/src/transport/host-transport.contract.test.ts`
- Modify: `mobile/src/api/TrackerClientProvider.tsx`
- Preserve: `mobile/src/realtime/assistant-session.ts` and `mobile/src/realtime/terminal-session.ts`
- Modify: `mobile/src/auth/ConnectionProvider.tsx`

- [x] **Step 1: Write the shared transport contract test**

Run one fixture suite against both adapters and require the same mobile domain
models for host health, projects, tasks, threads and capabilities.

```ts
export interface HostTransport {
  readonly hostId: string;
  call<TResult>(method: string, params: unknown, signal?: AbortSignal): Promise<TResult>;
  subscribe<TEvent>(
    method: string,
    params: unknown,
    onEvent: (event: TEvent) => void,
  ): Promise<() => void>;
  reconnect(): void;
  close(): void;
}
```

- [x] **Step 2: Verify RED**

Run the focused contract test in WSL.

- [x] **Step 3: Implement adapters**

`RpcHostTransport` uses one authenticated encrypted socket per selected host.
`LegacyHostTransport` wraps the existing REST client and Phoenix adapters
without changing their wire behavior.

- [x] **Step 4: Verify GREEN and commit**

Commit: `refactor(mobile): introduce host transport compatibility layer`

### Task 6: Pairing UX and secure HostProfile migration

**Files:**

- Modify: `mobile/app.config.ts`
- Modify: `mobile/src/auth/connection-profile.ts`
- Modify: `mobile/src/auth/connection-storage.ts`
- Modify: `mobile/src/auth/connection-storage.test.ts`
- Create: `mobile/src/auth/host-credential-storage.ts`
- Create: `mobile/src/features/connect/PairHostScreen.tsx`
- Create: `mobile/src/features/connect/PairHostScreen.test.tsx`
- Modify: `mobile/src/features/connect/ConnectScreen.tsx`
- Modify: `mobile/src/features/connections/ConnectionsScreen.tsx`
- Modify: `mobile/app/connect.tsx`

- [x] **Step 1: Write failing profile migration and pairing UI tests**

Prove v1 legacy profile migration, v2 RPC profile storage, secret/key exclusion
from AsyncStorage, QR/manual parsing, endpoint reachability, host key pinning,
authentication before save, draft retention and explicit legacy labeling.

```ts
export type HostProfile = {
  id: string;
  hostId: string;
  name: string;
  endpoint: string;
  hostPublicKeyFingerprint: string;
  transport: "rpc" | "legacy";
  protocolVersion: number | null;
  createdAt: string;
  lastConnectedAt: string | null;
};
```

- [x] **Step 2: Verify RED**

Run the storage and screen Jest tests in WSL.

- [x] **Step 3: Implement QR/deep-link pairing**

Use Expo Camera only for QR capture. Manual paste is always present. Save
device token and full pinned key only after encrypted authentication succeeds.

- [x] **Step 4: Verify GREEN and commit**

Commit: `feat(mobile): add encrypted Symphony host pairing`

### Task 7: Multi-host switching, isolation and reconnection

**Files:**

- Create: `mobile/src/rpc/host-connection-manager.ts`
- Create: `mobile/src/rpc/host-connection-manager.test.ts`
- Modify: `mobile/src/api/QueryProvider.tsx`
- Modify: `mobile/src/api/query-cache-persistence.ts`
- Modify: `mobile/src/features/connections/ConnectionsRoute.tsx`
- Modify: `mobile/src/features/connections/ConnectionsScreen.tsx`
- Modify: `mobile/src/features/sessions/SessionLibraryRoute.tsx`
- Modify: `mobile/src/diagnostics/diagnostic-log.ts`

- [ ] **Step 1: Write failing two-host isolation tests**

Prove that two hosts may reuse project/thread/issue ids without sharing Query
data, drafts, sockets or notification routes. Prove host switch closes old
subscriptions before hydrating the new host cache.

- [ ] **Step 2: Write failing reconnection tests**

Use fake timers to prove heartbeat ageing, two missed acknowledgements, capped
exponential backoff with jitter, foreground/network retry, revoked/key-mismatch
terminal states and protocol incompatibility.

- [ ] **Step 3: Verify RED**

Run the two focused Vitest files in WSL.

- [ ] **Step 4: Implement manager and states**

Every Query key begins with `["host", hostId, ...]`. Diagnostics expose only
endpoint, fingerprint, negotiated version, heartbeat age and redacted codes.

- [ ] **Step 5: Verify GREEN and commit**

Commit: `feat(mobile): isolate and reconnect multiple Symphony hosts`

### Task 8: Migrate projects, tasks and session control to RPC

**Files:**

- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/projects.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/tasks.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/sessions.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/approvals.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/core_test.exs`
- Modify: `mobile/src/api/contracts.ts`
- Modify: `mobile/src/features/tasks/useTasks.ts`
- Modify: `mobile/src/features/tasks/useIssueDetail.ts`
- Modify: `mobile/src/features/tasks/IssueScreen.tsx`
- Modify: `mobile/src/features/sessions/useSessionLibrary.ts`
- Modify: `mobile/src/realtime/assistant-session.ts`

- [ ] **Step 1: Extract shared host services behind controllers/channels**

RPC handlers and legacy endpoints must call the same project, issue, blocker,
subtask, comment, thread, approval and question services.

- [ ] **Step 2: Write failing parity tests**

For each domain operation, compare RPC and legacy DTOs. Include navigable
blockers, subtask list/create, session history, streaming deltas, queued
messages, goal state, approvals, questions, interrupt and resume.

- [ ] **Step 3: Verify RED**

Run mobile feature tests in WSL; run host RPC parity tests in CI.

- [ ] **Step 4: Implement methods and subscriptions**

Use `projects.*`, `tasks.*`, `sessions.*`, `approvals.*` and `questions.*`.
Bind all stream cursors to the authenticated device and current host.

- [ ] **Step 5: Verify GREEN and commit**

Commit: `feat(mobile-rpc): migrate tasks and sessions`

### Task 9: Migrate workspace, Git, PR and preview operations

**Files:**

- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/terminal.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/files.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/diff.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/git.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/pull_requests.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/previews.ex`
- Create: `elixir/test/symphony_elixir/mobile_rpc/methods/workspace_test.exs`
- Modify: `mobile/src/realtime/terminal-session.ts`
- Modify: `mobile/src/features/workspace/FilesRoute.tsx`
- Modify: `mobile/src/features/workspace/PreviewRoute.tsx`
- Modify: `mobile/src/features/source-control/DiffRoute.tsx`
- Modify: `mobile/src/features/pull-requests/PullRequestRoute.tsx`

- [ ] **Step 1: Write failing sandbox and stream parity tests**

Prove terminal snapshot/delta/input/resize, source/Markdown/image files,
traversal/symlink/size rejection, diff patch, commit/push, PR checks/actions and
preview lifecycle all target the selected host.

- [ ] **Step 2: Verify RED**

Run focused mobile tests in WSL and host integration tests in CI.

- [ ] **Step 3: Implement bounded RPC methods**

Preserve existing workspace sandbox and Git/PR authorization. Use binary
encrypted frames only where they materially reduce terminal/file overhead.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `feat(mobile-rpc): migrate workspace and source control`

### Task 10: Device management and host-routed notifications

**Files:**

- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/devices.ex`
- Create: `elixir/lib/symphony_elixir/mobile_rpc/methods/notifications.ex`
- Modify: `elixir/lib/symphony_elixir/push_notifications/mobile_subscription.ex`
- Create: `mobile/src/features/connections/PairedDevicesScreen.tsx`
- Create: `mobile/src/features/connections/PairedDevicesScreen.test.tsx`
- Modify: `mobile/src/native/notifications.ts`
- Modify: `mobile/src/native/expo-services.ts`
- Modify: `mobile/src/features/notifications/NotificationsRoute.tsx`

- [ ] **Step 1: Write failing revocation and routing tests**

Prove list/revoke-by-device, current-device self-revoke, live socket
termination, push subscription ownership by host/device and deep links that
select the host before opening a task/session.

- [ ] **Step 2: Verify RED**

Run focused mobile tests in WSL and host tests in CI.

- [ ] **Step 3: Implement methods and UI**

Never return token digests. Show device name, scope, paired time, last seen,
protocol and status only.

- [ ] **Step 4: Verify GREEN and commit**

Commit: `feat(mobile-rpc): add paired devices and host notifications`

### Task 11: Compatibility audit and legacy migration gate

**Files:**

- Create: `docs/superpowers/specs/fixtures/mobile-rpc-capabilities-v1.json`
- Create: `mobile/src/transport/compatibility-audit.test.ts`
- Create: `elixir/test/symphony_elixir/mobile_rpc/legacy_compatibility_test.exs`
- Modify: `docs/superpowers/specs/2026-07-23-symphony-mobile-companion-design.md`
- Modify: `docs/superpowers/specs/2026-07-25-symphony-mobile-multi-host-rpc-design.md`

- [ ] **Step 1: Build the capability matrix**

Record every mobile operation, its RPC method, legacy endpoint/channel,
required scope, streaming behavior and evidence.

- [ ] **Step 2: Verify web/desktop compatibility in CI**

Run existing controller/channel suites plus new RPC suites. A new RPC handler
must not change legacy response or Phoenix event contracts accidentally.

- [ ] **Step 3: Verify migration behavior**

New profiles must always use RPC. Legacy profiles remain functional and display
a re-pair action. No code path may silently reuse the global tracker token as a
device token.

- [ ] **Step 4: Commit**

Commit: `test(mobile-rpc): verify legacy compatibility and migration`

### Task 12: CI-native E2E, complete MP4 and PR report

**Files:**

- Modify: `.github/workflows/mobile-e2e.yml`
- Modify: `mobile/e2e/android-smoke.sh`
- Create: `mobile/e2e/multi-host-smoke.sh`
- Modify: `mobile/src/e2e/fixture-runtime.ts`
- Create: `mobile/artifacts/e2e/multi-host-mobile-report.md`

- [ ] **Step 1: Add two deterministic host fixtures**

Host A and Host B must have overlapping ids but visibly different identities,
projects, sessions and agent states. The fixture RPC uses the production
handshake/transport boundary and deterministic domain services.

- [ ] **Step 2: Run the complete journey on a dedicated runner**

The flow pairs Host A by QR, pairs Host B by deep link, switches hosts, verifies
cache isolation, navigates tasks/blockers/subtasks, operates a session,
approval, question, terminal, preview, source/Markdown/image files, diff,
commit/push, PR, notification, diagnostics, usage and device revocation.

- [ ] **Step 3: Record and validate MP4**

Record the whole phone experience, transcode to broadly playable H.264/AAC MP4,
verify duration/resolution/decodability and attach the CI report. Do not record
pairing secrets; use redacted fixture offers.

- [ ] **Step 4: Run release evidence**

In CI/dedicated runners:

```bash
cd mobile
npm run test
npm run typecheck
npm run lint
npm run format:check
npm run doctor
npm run build:android:e2e
```

Run focused Elixir mobile RPC, controller and channel suites in the Elixir CI
job. Run iOS smoke on a macOS runner.

- [ ] **Step 5: Publish evidence**

Update the existing Gist with the new MP4/report, push the branch, and update
PR #7 description with:

- architecture decision and migration status;
- direct MP4 link;
- Gist link;
- full capability/compatibility matrix;
- CI run links;
- known external requirements such as reachable host endpoint and push
  credentials.

- [ ] **Step 6: Final acceptance audit**

Check every criterion in both mobile design specs and this plan. Do not mark the
goal complete while any required method, runtime proof, video or PR report is
missing.

Commit: `test(mobile): add encrypted multi-host end-to-end evidence`
