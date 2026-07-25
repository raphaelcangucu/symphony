# Symphony Mobile Multi-Host RPC Design

Date: 2026-07-25
Status: Approved architectural decision

## Decision

Symphony Mobile connects directly to one selected Symphony host at a time.
Every host owns its projects, workspaces, sessions, agents, credentials and
runtime state, and exposes a mobile-scoped WebSocket RPC transport. A central
tracker or relay may be offered later as an optional discovery or tunneling
service, but it is not required to operate other hosts.

This decision supersedes the original assumption in
`2026-07-23-symphony-mobile-companion-design.md` that the mobile app is primarily
a REST client plus a set of Phoenix Channels authenticated by one shared
tracker bearer token. The existing REST and Phoenix contracts remain supported
during migration and continue serving the web/desktop app. Their business
services are reused behind the new RPC boundary.

The clean Codex-style session hierarchy remains the primary UX. The connection
shown in that hierarchy is now a concrete Symphony machine rather than an
abstract central tracker profile.

## Approaches Considered

### 1. In-process mobile RPC gateway on every Symphony host

Phoenix hosts the WebSocket lifecycle, while focused RPC handlers call the same
contexts and services used by controllers and channels. This preserves one
runtime and one source of business rules, supports direct host control, and
allows method-by-method migration. This is the selected approach.

### 2. Separate mobile sidecar beside Symphony

A sidecar could isolate the protocol, but it would duplicate deployment,
authentication, supervision, logs and access to live agent processes. It also
creates another mandatory service on every machine. It is rejected as the
default architecture.

### 3. Central mobile hub controlling all Symphony machines

A hub simplifies discovery but introduces a mandatory trust and availability
dependency, contradicts direct Orca-style host pairing, and makes local-only
machines harder to support. It is rejected as a requirement. A future optional
relay must preserve end-to-end encryption and host identity pinning.

## System Model

### Host identity

Each Symphony installation creates one persistent X25519 host key pair and a
random `host_id` on first enablement of mobile RPC. The public key and `host_id`
identify the host to paired phones. The private key never leaves the host and
is stored using the same hardened local-secret conventions as Symphony
credentials.

Host display metadata contains:

- stable `host_id`;
- operator-selected host name;
- platform and Symphony version;
- mobile RPC protocol minimum and maximum versions;
- reachable WebSocket endpoint;
- pinned X25519 public key fingerprint.

Changing the host key is an explicit destructive rotation. Rotation invalidates
existing pairings and requires clear confirmation.

### Device credentials

Every paired mobile device receives a distinct random credential with the
`mobile` scope. The host stores only a keyed hash of the credential plus:

- `device_id`;
- user-visible device name;
- scope;
- creation and last-seen timestamps;
- revocation timestamp;
- last negotiated protocol version.

The raw credential exists only inside the pairing offer and the phone's secure
storage. Devices can be listed and revoked individually. Revocation terminates
all live sockets for that device and rejects future authentication. A global
tracker bearer token is never the steady-state mobile credential.

### Pairing offer

The host generates a pending device entry and renders a QR code/deep link:

```text
symphony://pair?code=<base64url-json>
```

The versioned payload contains:

```json
{
  "v": 1,
  "endpoint": "wss://host.example/mobile/rpc",
  "host_id": "host_...",
  "host_name": "Raphael workstation",
  "host_public_key": "<base64>",
  "device_id": "device_...",
  "device_token": "<single-device secret>",
  "scope": "mobile",
  "protocol_min": 1,
  "protocol_max": 1
}
```

Pending offers do not appear as active devices until their first successful
encrypted authentication. Regenerating an unused QR revokes the previous
pending credential. Pairing data is never written to logs, analytics, crash
reports or AsyncStorage. The token and pinned host key are stored in
`expo-secure-store`.

Manual paste remains available for accessibility and recovery. The legacy
`symphony://connect?url=...&token=...` tracker link is accepted only by the
compatibility path and is clearly labeled legacy.

## Encrypted Handshake

The application-layer protocol uses reviewed cryptographic libraries rather
than custom primitives:

- X25519 for ephemeral-mobile/static-host key agreement;
- HKDF-SHA-256 over the shared secret and complete handshake transcript;
- separate client-to-host and host-to-client keys;
- ChaCha20-Poly1305 authenticated encryption;
- monotonic 64-bit sequence numbers incorporated into nonces and authenticated
  additional data.

The sequence is:

1. Mobile opens WSS/WS and sends plaintext `hello` containing protocol range,
   pinned `host_id`, a fresh ephemeral X25519 public key and a random challenge.
2. Host verifies that a common protocol exists, derives session keys from its
   static private key and the mobile ephemeral public key, and returns a
   plaintext `ready` containing the selected version and host challenge.
3. Mobile verifies the selected version and derives the same directional keys
   using the pinned host public key.
4. Mobile sends `auth` as the first encrypted frame. It contains device id,
   device token, both challenges and the handshake transcript hash.
5. Host validates the credential only after decryption and replies with an
   encrypted `authenticated` frame containing host identity, capabilities,
   heartbeat interval and server time.
6. Only then may either side send RPC or stream frames.

TLS/WSS remains required for non-local production endpoints and protects
metadata in transit. Application E2EE remains mandatory because TLS is not a
replacement for host pinning or per-device encrypted authentication.

Frames with repeated, skipped beyond the allowed window, overflowing or invalid
sequence numbers close the connection. Authentication failures, malformed
ciphertext and excessive decryption failures close the connection without
revealing credential validity in plaintext. Session keys are discarded on
disconnect and regenerated for every reconnect.

## RPC and Stream Contract

The plaintext inside the encrypted channel uses a small versioned envelope:

```ts
type RpcRequest = {
  type: "rpc";
  id: string;
  method: string;
  params: unknown;
  deadline_ms?: number;
};

type RpcResult =
  | { type: "result"; id: string; ok: true; result: unknown }
  | {
      type: "result";
      id: string;
      ok: false;
      error: { code: string; message: string; retryable: boolean; data?: unknown };
    };

type StreamEvent = {
  type: "event";
  subscription_id: string;
  sequence: number;
  event: string;
  payload: unknown;
};
```

Every method is registered with a schema, required device scope, timeout class
and audit label. Unknown or forbidden methods fail closed. Mobile scope exposes
only the mobile allowlist.

Initial namespaces are:

- `system.*`: identity, health, capability negotiation, heartbeat and usage;
- `devices.*`: current-device metadata and self-revocation;
- `projects.*` and `tasks.*`: projects, issues, blockers, subtasks and comments;
- `sessions.*`: history, creation, messages, agent state and preferences;
- `approvals.*` and `questions.*`: pending requests and submissions;
- `terminal.*`: tabs, input, resize, snapshots and deltas;
- `files.*`, `diff.*` and `git.*`: workspace inspection, commit and push;
- `pull_requests.*`: status, checks, update branch, rerun, fix and merge;
- `previews.*`: dev-server discovery and lifecycle;
- `notifications.*`: mobile subscription and host events.

Streams are connection-scoped subscriptions with explicit subscribe,
unsubscribe and resume cursors. The server cleans them up on disconnect.
Backpressure is bounded; terminal/file binary streams have stricter limits than
JSON state events.

## Host Selection and State Isolation

The mobile connection profile becomes a `HostProfile` containing only safe
metadata in AsyncStorage. SecureStore holds the device credential and pinned
host key under the profile id. Every RPC client, Query key, cache snapshot,
draft, socket, stream subscription and notification route includes the
`host_id`.

Switching hosts:

1. stops subscriptions and discards session keys for the old host;
2. persists its cache independently;
3. selects the new host profile;
4. opens and authenticates one new RPC connection;
5. hydrates only the selected host's cached state;
6. renders that host's projects, sessions and agents.

IDs are never assumed globally unique across hosts.

## Reconnection, Compatibility and Offline Behavior

The client sends heartbeat frames at the negotiated interval and marks a host
stale after two missed acknowledgements. Reconnect uses capped exponential
backoff with jitter and immediately retries when the app returns to the
foreground or the network becomes reachable.

Connection state distinguishes:

- `pairing`;
- `connecting`;
- `handshaking`;
- `authenticating`;
- `online`;
- `reconnecting`;
- `offline`;
- `revoked`;
- `host_key_mismatch`;
- `protocol_incompatible`.

The host advertises protocol range and capability flags during authentication.
No RPC is attempted when no common protocol exists. Unknown optional
capabilities disable only their associated UI. Host key mismatch is never
silently accepted.

## Migration and Compatibility

Migration is method-by-method:

1. Add host identity, device registry, pairing and encrypted `system.*` RPC.
2. Introduce a mobile `HostTransport` interface with RPC and legacy
   implementations.
3. Migrate read models and connection health to RPC.
4. Migrate session/approval/question streams.
5. Migrate terminal, files, diffs, Git, pull requests and previews.
6. Migrate notifications and remove the global bearer token from new mobile
   pairings.
7. Keep REST and Phoenix Channels for web/desktop and legacy mobile profiles
   during a documented compatibility window.

Native RPC handlers call extracted application services and do not duplicate
tracker logic. During the compatibility phase, an explicitly allowlisted
in-process `TrackerBridge` may invoke an existing controller with a reconstructed
local `Plug.Conn`; it never performs a network HTTP request, never accepts an
absolute URL and never reuses tracker bearer authentication. This bridge is a
transitional parity adapter, not the final service boundary. Controllers and
RPC handlers move to the same extracted services domain by domain.

The implemented capability and migration status is recorded in
`fixtures/mobile-rpc-capabilities-v1.json`. New RPC profiles never fall back to
REST or Phoenix on the wire: compatibility adapters execute only inside the
selected Symphony host after encrypted device authentication.

A profile records `transport: "rpc" | "legacy"`. New QR pairings always create
`rpc` profiles. Existing profiles migrate only after explicit successful
pairing; credentials are not silently transformed.

## Security and Diagnostics

- Secrets and plaintext encrypted frames are redacted from logs.
- Device-token comparisons are constant-time.
- Pairing and authentication endpoints are rate-limited.
- RPC payload sizes, stream counts, buffered bytes and method concurrency are
  bounded.
- File and terminal methods preserve existing workspace sandbox boundaries.
- Dangerous Git/PR operations retain current server-side authorization and
  audit behavior.
- Native notification payloads include the owning host/profile id; the mobile
  selects that paired host before opening the allowlisted task/session route.
- Diagnostics expose endpoint reachability, pinned fingerprint, protocol
  negotiation, heartbeat age and redacted failure codes.
- Exported diagnostics never include device tokens, private/session keys,
  plaintext RPC bodies or notification tokens.

## Validation Strategy

Lightweight unit tests run in WSL:

- pairing-offer validation and redaction;
- host/device registry lifecycle;
- fixed cross-language X25519/HKDF/AEAD vectors;
- handshake state machines and replay rejection;
- RPC schema/allowlist/timeout behavior;
- host-profile cache isolation and switching;
- adapter contract tests proving RPC and legacy transports return the same
  mobile domain models.

Elixir integration tests, native dependency builds, Expo prebuild, emulators,
Maestro and MP4 recording run in GitHub Actions or a dedicated native runner,
never as heavy jobs in WSL.

## Acceptance Criteria

1. Two independent Symphony hosts can be paired and switched without shared
   state or a central hub.
2. Each host displays identity, fingerprint, health, protocol version and
   connectivity.
3. New pairings use QR/deep link, a pinned host key and a distinct mobile device
   credential stored securely.
4. A host can list and revoke one phone without affecting other devices.
5. RPC requests and streams are rejected before encrypted authentication.
6. Replay, host-key mismatch, revoked credential and incompatible protocol
   states are explicit and recoverable where appropriate.
7. Sessions, agents, approvals, questions, terminal, files, diffs, Git, pull
   requests, previews and notifications operate against the selected host.
8. REST/Phoenix web and desktop behavior remains compatible while mobile
   methods migrate to shared services behind RPC.
9. No mandatory central hub is required.
10. The approved clean session UX remains intact.
11. Cross-language crypto vectors, focused unit/integration tests and CI-native
    E2E evidence pass.
12. The final PR description contains the compatibility report and complete
    MP4 walkthrough.
