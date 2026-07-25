# Symphony Mobile

React Native companion for controlling one or more Symphony hosts directly.
Each paired host keeps its own projects, tasks, workspaces, sessions, agents,
and revocable device credential.

## Standalone mock server

The development mock follows Orca Mobile's proven model: one external
TypeScript WebSocket process, deterministic in-memory data, and the same
pairing/encryption/RPC path used by the production app. There is no mock mode in
the UI.

```bash
cd mobile
npm install
adb reverse tcp:4103 tcp:4103
npm run mock-server
```

Copy the `PAIRING_URL` printed at startup and open it on Android:

```bash
adb shell am start -W \
  -a android.intent.action.VIEW \
  -d "$PAIRING_URL" \
  -n dev.dev10x.symphony/.MainActivity
```

When stdout is redirected, the secret is intentionally withheld. Automation
must use a private file:

```bash
pairing_file="$(mktemp)"
MOCK_PAIRING_FILE="$pairing_file" npm run mock-server
# read locally, then remove "$pairing_file"; the server writes it with mode 0600
```

The URL and token are local secrets. Do not paste them into CI logs, reports,
screenshots, videos, or committed files. Restarting the mock creates a new host
key and requires pairing again.

Orca-style failure controls:

```bash
MOCK_RPC_DELAY_MS=1500 npm run mock-server
MOCK_ERROR_METHOD=tasks.request npm run mock-server
MOCK_DISCONNECT_AFTER_MS=1500 MOCK_DISCONNECT_ONCE=1 npm run mock-server
```

Stopping the process exercises offline behavior. Per-method delay uses
`MOCK_RPC_DELAY_<METHOD>_MS`, with punctuation replaced by underscores and the
name uppercased.

The server binds to `127.0.0.1:4103` and Android reaches it through `adb
reverse`. A physical device requires an explicit trusted-LAN bind and a private
`MOCK_PUBLIC_ENDPOINT`; public insecure `ws://` pairing is rejected.

## Evidence levels

- `e2e/android-smoke.sh`: app fixture only; no network.
- standalone mock: real mobile pairing, E2EE, RPC, streams, and reconnect with
  fake domain state.
- `e2e/multi-host-smoke.sh`: real Elixir hosts, database, bridges, and
  host-specific operations.

The mock is for deterministic development and UI E2E. It does not validate the
Elixir database, device digest/revocation, controller authorization, real
filesystem/Git/terminal/agent work, WSS, or native push delivery.
