# Orca Mobile vs. Symphony Mobile

## Evidence

The Orca baseline is the official `stablyai/orca` repository at commit
`505967eba0480b614cf83ae84d10183147949d30`, run on 2026-07-25 with its own
standalone mobile mock. The Android x86_64 build completed and the captured app
was paired through Orca's E2EE flow. Pairing credentials are redacted from all
published material.

Symphony uses two deliberately separate evidence levels:

- standalone mock: real Android app, deep-link pairing, secure credential
  storage, host-key pinning, application E2EE, WebSocket RPC, streams, cancel,
  disconnect and reconnect; domain data is deterministic and in memory;
- two real hosts: two independent Elixir runtimes, databases, device records,
  projects, tasks, sessions and workspace operations, each reached directly by
  the selected mobile host.

Neither product's mock proves real filesystem, Git, shell, agent, push-provider
or persistence behavior.

## What Symphony copied from Orca

Symphony copied the proven development shape instead of creating a UI mock
mode:

1. a standalone TypeScript WebSocket server started by a package script;
2. process-lifetime host keys and a per-socket encrypted state machine;
3. deterministic, mutable fixtures behind the normal RPC client;
4. direct method dispatch plus subscriptions and terminal/session streams;
5. global and per-method latency controls;
6. a one-time disconnect control for reconnect testing;
7. a normal pairing link, so the installed app follows the production
   transport path unchanged.

The wire messages were adapted to Symphony protocol v1 because copying Orca's
wire format would create a second incompatible protocol. Symphony therefore
keeps its approved X25519, HKDF-SHA-256 and ChaCha20-Poly1305 handshake,
per-device credential and direct selected-host routing.

## Visual and feature comparison

| Area | Official Orca Mobile | Symphony Mobile |
| --- | --- | --- |
| First run | Dedicated unpaired explanation and explicit `Pair Desktop` action | Clean connection entry and direct pairing deep link |
| Pairing | Confirmation, then Chat/Terminal and notification choices | Direct host registration using the selected host's identity, device credential and pinned key |
| Home hierarchy | Host → repository → worktree, with branch/PR/status metadata and filters | Host → project → session, optimized for a compact Codex-style chat library |
| Host switching | Paired-host list and workspace activation | Explicit Connections screen, health state, selected-host switch and isolated caches/transports |
| Session | Terminal-first or Chat choice | Chat-first timeline with live session events, approvals and user questions |
| Files | Folder tree and Markdown preview | Per-session file list/content routed to the selected host |
| Source control | Rich Changes screen with staged/unstaged groups, stage/discard and commit controls | Diff/patch, commit and push controls; less dense than Orca today |
| Pull requests | Dedicated tab, but hosted-review prerequisites were unavailable in the official mock run | PR view/actions routed through the selected Symphony host |
| Terminal | RPC fixtures exist, but the tested official mock lacks current session-tab methods so the session remained on `Loading tabs` | Bidirectional selected-host terminal stream covered by mock and real-host journeys |
| Offline/reconnect | Saved host and normal reconnection path | Backoff, heartbeat, offline state, logical stream re-subscription and fresh snapshot after reconnect |
| Test server | External official mock with mutable fixtures | External Orca-shaped mock using the production Symphony handshake and RPC contracts |

## Findings from the official Orca run

The visual strengths worth carrying forward are the calm dark hierarchy,
focused first-run explanation, clear pair confirmation, dense workspace
metadata when it is useful, capable file preview and the richer Source Control
screen.

The official mock at the tested commit is behind the current mobile client in
several places:

- `session.tabs.list` and `session.tabs.subscribe` are absent, leaving the
  session on `Loading tabs`;
- `git.history` is absent, so the Commits tab reports an unknown method;
- `repo.baseRefDefault` is absent, preventing base-branch comparison;
- hosted-review prerequisites are incomplete, so the Pull Request tab is
  unavailable.

These are mock/client-contract gaps, not emulator or recording failures.
Symphony guards against the same class of drift with focused handler tests that
pass mock payloads through the real mobile DTO mappers.

## Product direction

The comparison led to a stronger decision than visual inspiration. Symphony
will use the production Orca Mobile implementation as its default frontend
baseline, preserving its onboarding, host dashboard, responsive navigation,
workspace/session, terminal, files, Source Control, PR/review, diagnostics and
offline behavior. The frontend changes are limited to the Dev10x brand,
Symphony runtime/domain terminology, negotiated capability states and a
focused adapter to Symphony's RPC/domain model. Dev10x is the primary visible
app identity; Symphony identifies the host/runtime and RPC.

The existing clean Codex-style session library remains as a parallel,
device-wide selectable view over the same selected host, transport, caches and
domain state. It is not a second app or transport stack.

The standalone mock remains a development accelerator for deterministic
states. Release E2E evidence is captured against real local Symphony hosts.
Direct multi-host control, per-device E2EE pairing, projects/tasks/agents and
the absence of a mandatory central hub remain Symphony requirements.
