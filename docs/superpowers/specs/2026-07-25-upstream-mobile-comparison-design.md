# Orca Mobile Mock Comparison Design

**Status:** approved for direct implementation by the user on 2026-07-25

## Goal

Run the official Orca Mobile app against its own mock WebSocket server, capture
reproducible visual evidence, and port the same standalone mock-server concept
to Symphony Mobile without adding a mock mode to the app.

## Source baseline

The comparison uses `stablyai/orca` commit
`505967eba0480b614cf83ae84d10183147949d30`. Orca has additional fixture helper
modules, while its core server spine is:

- `mobile/scripts/mock-server.ts`
- `mobile/scripts/mock-server-encryption.ts`
- `mobile/scripts/mock-server-rpc-handlers.ts`
- the `mock-server` package script

The Symphony implementation copies that execution model and the
responsibilities of those core files. It deliberately does not introduce a
control service, scenario framework, mock-only navigation, or alternate client
transport.

## Architecture

`npm run mock-server` starts a loopback-only Node/TypeScript `WebSocketServer`
on port 4103. It owns an in-memory host key for the process lifetime, one local
device token, deterministic domain fixtures, and a state map per WebSocket. At
startup it publishes a normal `symphony://pair` deep link to an interactive
terminal or a private mode-0600 file selected by automation. The installed app
parses that link and traverses the production `HandshakeWebSocketAdapter`,
`MobileHandshake`, `RpcClient`, `RpcHostTransport`, and
`HostConnectionManager`.

The three files retain the Orca boundaries:

1. `mock-server.ts` owns process configuration, WebSocket lifecycle, pairing,
   authentication, logging, cancellation, and subscription cleanup.
2. `mock-server-encryption.ts` implements the server half of Symphony protocol
   v1 using the same pure crypto primitives as the mobile client.
3. `mock-server-rpc-handlers.ts` owns the direct switch dispatcher, fixtures,
   mutations, response delays, and stream events.

## Required Symphony protocol adaptation

The Orca structure is copied, while its wire crypto cannot be copied because
Symphony already has an approved protocol:

- plaintext `hello` and `hello_ack`;
- X25519 shared secret;
- transcript SHA-256 and HKDF-SHA-256 directional keys;
- ChaCha20-Poly1305 authenticated encryption;
- binary `uint64 sequence || ciphertext` frames;
- encrypted device authentication at sequence 1;
- encrypted RPC traffic starting at sequence 2;
- `result` metadata containing host id, protocol, and server timestamp;
- `subscription_id` events with strictly increasing sequence numbers.

The mock does not bypass pairing, secure credential storage, pinning, sequence
validation, or the normal RPC client.

## Domain coverage

The dispatcher exposes the mobile v1 capability names used by the app:

- system identity, health, capabilities, heartbeat, usage, and tracker bridge;
- device listing;
- project, task, session, workspace, Git, preview, pull request, and
  notification bridge requests;
- session and terminal subscriptions and commands;
- cancel and unsubscribe envelopes.

Fixtures cover projects, tasks, task detail/comments/blockers/subtasks, session
history and assistant deltas, file lists/content, diffs, terminal output,
preview state, pull requests, and notification registration. Git commit/push
and selected task/session mutations update in-memory state, matching the Orca
mock's behavior.

## Failure and reconnect controls

The port preserves Orca-style environment knobs rather than adding a scenario
control plane:

- `MOCK_RPC_DELAY_MS`;
- `MOCK_RPC_DELAY_<METHOD>_MS`;
- `MOCK_ERROR_METHOD`;
- `MOCK_DISCONNECT_AFTER_MS`;
- `MOCK_DISCONNECT_ONCE=1`.

Stopping the process exercises offline behavior. A one-time disconnect proves
backoff and logical stream re-subscription. Reconnected subscriptions receive a
new id and a fresh sequence-1 snapshot; protocol v1 does not claim cursor
resume.

## Safety

The default bind is `127.0.0.1`, Android uses `adb reverse`, the path is exactly
`/mobile/rpc`, payloads are capped at 1 MiB, and handshakes time out after ten
seconds. Only the initial hello may be plaintext. Invalid authentication,
sequence, or AEAD closes the socket. The mock never executes a shell, Git,
filesystem, agent, or push provider. Exposing it to a LAN requires an explicit
bind and a private endpoint.

## Evidence boundary

Three evidence levels remain distinct:

- app fixture smoke: UI-only, no network;
- standalone mock: real mobile pairing/E2EE/RPC with fake domain state;
- multi-host smoke: real Elixir hosts, database, bridges, and server security.

Mock evidence is labeled `backend: mock` and never presented as proof of the
Elixir runtime, persistence, revocation, sandbox, real Git/terminal/agent
execution, WSS, or native push delivery.

## Comparison output

The report records the Orca commit, exact commands, screenshots, video, feature
matrix, and visual observations. It compares information hierarchy, host and
workspace selection, session creation, terminal/files/Git affordances,
connection state, and empty/error/offline behavior. It does not claim pixel
parity where the products have different domain models.
