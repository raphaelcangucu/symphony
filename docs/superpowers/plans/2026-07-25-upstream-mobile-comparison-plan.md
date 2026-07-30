# Orca Mobile Mock Comparison Implementation Plan

**Goal:** Reproduce Orca Mobile with its official mock server and add the same standalone mock-server workflow to Symphony Mobile.

**Architecture:** Port Orca's standalone Node/TypeScript server spine directly. Route the unchanged Symphony app through its production pairing, encryption, RPC, transport, and reconnection layers; keep fake domain state only in the server handler.

**Tech Stack:** Expo/React Native, TypeScript, `ws`, `tsx`, Noble X25519/HKDF/ChaCha primitives, Android emulator, ADB, ffmpeg.

---

### Task 1: Record the Orca source baseline

**Files:**
- Create: `mobile/artifacts/comparison/orca-source.json`
- Create: `mobile/artifacts/comparison/orca-commands.txt`

- [ ] Record commit `505967eba0480b614cf83ae84d10183147949d30`,
  Node/pnpm versions, mock command, build command, install command, and deep-link
  command.
- [ ] Start `pnpm mock-server` from the official checkout and retain its
  redacted startup metadata.
- [ ] Verify that the endpoint listens before launching the app.

### Task 2: Capture Orca Mobile visual evidence

**Files:**
- Create: `mobile/artifacts/comparison/orca-mobile-mock-e2e.mp4`
- Create: `mobile/artifacts/comparison/orca/screens/*.png`
- Create: `mobile/artifacts/comparison/orca-contact-sheet.png`

- [ ] Install the official Orca Android build on the existing emulator without
  stopping or deleting the emulator.
- [ ] Pair with the official mock server and traverse home/workspaces, new
  workspace/session affordances, terminal, files, Git/diff, and settings that
  are exposed by the mock.
- [ ] Record the screen once, capture milestone screenshots, and generate a
  contact sheet.
- [ ] Decode the whole MP4 with ffmpeg and visually reject black or stale
  frames.

### Task 3: Port the standalone server process

**Files:**
- Create: `mobile/scripts/mock-server.ts`
- Modify: `mobile/package.json`
- Modify: `mobile/package-lock.json`

- [ ] Add `tsx`, `ws`, and `@types/ws`, then add
  `"mock-server": "npx tsx scripts/mock-server.ts"`.
- [ ] Copy Orca's process layout: fixed local token, process-lifetime host key,
  `WebSocketServer`, per-socket map, direct event callbacks, startup summary,
  and cleanup.
- [ ] Bind to `127.0.0.1:4103`, cap payloads at 1 MiB, require
  `/mobile/rpc`, and print a standard Symphony pairing link.
- [ ] Reject production use and require explicit opt-in for non-loopback bind.

### Task 4: Implement the protocol-compatible server handshake

**Files:**
- Create: `mobile/scripts/mock-server-encryption.ts`
- Test: `mobile/src/rpc/mock-server-encryption.test.ts`

- [ ] Write a failing interop test using `MobileHandshake` against the
  server-side helper.
- [ ] Implement hello validation, host identity pinning data, transcript hash,
  shared secret, directional session keys, auth verification, and binary
  sequence framing with the existing pure crypto primitives.
- [ ] Prove successful auth and rejection of wrong tokens, wrong transcript,
  replay, tampering, and unexpected plaintext after hello.

### Task 5: Port Orca's direct dispatcher and fixtures

**Files:**
- Create: `mobile/scripts/mock-server-rpc-handlers.ts`
- Test: `mobile/src/rpc/mock-server-rpc-handlers.test.ts`

- [ ] Copy the Orca `handleRequest(request, send, ws)` shape, `success/error`
  helpers, switch dispatcher, mutable fixtures, and global/per-method delay.
- [ ] Return Symphony controller DTOs from system/project/task/session/workspace
  routes.
- [ ] Add in-memory Git, preview, pull request, and notification responses.
- [ ] Return `method_not_allowed` for every non-allowlisted method without
  reflecting secret params.

### Task 6: Port streaming, cancellation, and reconnect behavior

**Files:**
- Modify: `mobile/scripts/mock-server.ts`
- Modify: `mobile/scripts/mock-server-rpc-handlers.ts`
- Test: `mobile/src/rpc/mock-server-rpc-handlers.test.ts`

- [ ] Return one subscription result, then emit monotonic session or terminal
  events under its subscription id.
- [ ] Clean timers and subscription state on unsubscribe and socket close.
- [ ] Echo terminal input and emit deterministic assistant message/delta/
  completion sequences.
- [ ] Add Orca-style delay/error/disconnect environment knobs and prove a
  one-time disconnect stabilizes after client backoff/re-subscription.

### Task 7: Document and run Symphony mock E2E

**Files:**
- Create: `mobile/README.md`
- Create: `mobile/e2e/mock-server-smoke.sh`
- Create: `mobile/artifacts/comparison/symphony-mobile-mock-e2e.mp4`
- Create: `mobile/artifacts/comparison/symphony/screens/*.png`

- [ ] Document `adb reverse tcp:4103 tcp:4103`, `npm run mock-server`, pairing,
  latency, error, disconnect, and offline commands.
- [ ] Run the installed Symphony app through the printed deep link, session,
  task, files, diff, terminal, host switch, disconnect, and reconnect flow.
- [ ] Label every artifact and trace with `backend: mock`.

### Task 8: Compare products and preserve real-host validation

**Files:**
- Create: `mobile/artifacts/comparison/orca-vs-symphony-mobile.md`
- Modify: `mobile/e2e/multi-host-smoke.sh`

- [ ] Build a factual visual/feature matrix from the captured screens and
  source-observed mock methods.
- [ ] Keep the real two-Elixir-host smoke as the final release evidence and add
  no mock shortcut to it.
- [ ] Run only focused unit/interop files, TypeScript check, targeted format/
  lint, APK build, Orca mock E2E, Symphony mock E2E, and one final real-host
  E2E. Do not run full heavy local test suites.

### Task 9: Publish

**Files:**
- Modify: PR #7 description
- Update: Gist `89652c626c9583cb9b0c52d8d5b2a708`

- [ ] Request an independent final code/evidence review.
- [ ] Commit and push the intended files.
- [ ] Replace stale Gist media with both comparison evidence and the final
  Symphony real-host video/report.
- [ ] Update the PR with architecture, mock boundary, comparison table, focused
  checks, hashes, and direct video links.
