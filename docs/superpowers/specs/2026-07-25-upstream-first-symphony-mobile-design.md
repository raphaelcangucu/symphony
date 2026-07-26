# Orca-First Symphony Mobile Design

Date: 2026-07-25
Status: Approved by the user
Scope: Symphony Mobile in the current mobile companion PR

## Decision

Symphony Mobile adopts the production Orca Mobile application as its primary
frontend baseline. The implementation copies the Orca routes, interaction
patterns, responsive layouts, state handling, diagnostics and operational
screens that already work, instead of recreating visually similar screens.

Frontend divergence is intentionally narrow:

- replace Orca identity with the Dev10x logo, name and product identity;
- rewrite product names, labels and messages for Symphony hosts, projects,
  workspaces, sessions and agents;
- replace Orca's concrete backend integration with Symphony's direct,
  encrypted, multi-host RPC transport;
- preserve the existing Codex-style Symphony interface as a secondary
  device-wide view mode.

The standalone mock-server concept remains part of the repository because it
shortens development feedback and provides deterministic protocol scenarios.
It is not the acceptance backend. Published end-to-end evidence runs against
real local Symphony hosts.

This decision supersedes the UI direction in
`2026-07-25-symphony-mobile-multi-host-rpc-design.md` and
`2026-07-23-symphony-mobile-companion-design.md` where the Codex-style session
library was the primary shell and Orca was only an inspiration. The approved
multi-host, per-device credential and application-E2EE architecture remains
unchanged.

## Source Baseline and Provenance

The import baseline is `stablyai/orca` commit
`5c3c2f2b3daf9d8563581c389712d805bfb256a1`. The implementation records this
commit in an upstream provenance document so later Orca fixes can be compared
and selectively brought forward.

Orca is MIT-licensed, Copyright (c) 2026 Lovecast Inc. Substantial copied
portions retain the MIT copyright and permission notice in Symphony's
third-party notices. Existing source-level notices are preserved. Dev10x does
not reuse the Orca name, logo or marine branding and does not claim authorship
of copied Orca code.

The existing Dev10x assets under `tracker/public/` are the branding source.
Mobile-safe copies are generated or added under `mobile/assets/` without
modifying the original tracker assets. **Dev10x is the primary and visible app
brand.** Symphony names the technical runtime, RPC protocol and paired hosts;
it is not presented as a competing consumer brand.

## Approaches Considered

### 1. Orca frontend baseline with a Symphony transport adapter

Copy the Orca Mobile application structure and keep its production screen and
component behavior. Introduce one Symphony backend boundary beneath it. Keep
the current Codex-style screens as a second shell over the same connection and
domain state.

This is selected because it maximizes reuse of proven behavior, minimizes
visual drift and concentrates Symphony-specific risk in a testable transport
and domain-mapping layer.

### 2. Port Orca screen by screen into the existing Symphony shell

This would preserve more current filenames, but every screen would require
reinterpretation. The earlier E2E already demonstrated the resulting visual
and feature gap. It is rejected because it creates the most regression risk.

### 3. Ship independent Orca-style and Codex-style applications

Two application roots would make the first copy simpler but would duplicate
pairing, secure storage, caches, notifications, transports and migrations.
They would drift quickly. It is rejected in favor of one runtime with two view
shells.

## Application Architecture

The application has one backend and state core with two presentation shells:

```text
Orca shell (default) ─┐
                     ├─ shared domain stores ─ SymphonyHostTransport ─ host RPC
Codex shell          ┘
                                    │
                                    └─ standalone mock server in development
```

### Shared core

The following services are singletons shared by both visual modes:

- paired-host registry and selected-host state;
- SecureStore-backed device credentials and pinned host keys;
- encrypted handshake and WebSocket RPC client;
- connection manager, heartbeat, reconnect and host diagnostics;
- host-scoped query keys, caches, drafts and stream subscriptions;
- normalized projects, workspaces, sessions, agents, terminal, files, Git,
  pull requests, previews and notification state;
- semantic deep-link routing.

Changing visual mode never creates a second socket, duplicates a subscription,
re-pairs a host or copies cached domain data. All cache and transport keys
remain scoped by `host_id`.

### Orca shell

The Orca shell is the default for new and existing installations after this
migration. It retains the upstream information architecture and interactions:

- first-run explanation, scan/manual pairing and explicit pair confirmation;
- host dashboard, identity, reachability and health;
- host → repository/project → worktree/workspace navigation;
- creation and resumption of workspaces and sessions;
- chat and terminal session experience;
- file explorer and preview;
- changes, history, review, Git and pull-request screens;
- approvals, questions, notifications, account/usage and diagnostics;
- responsive phone and tablet behavior, drawers, sheets, loading states and
  offline/reconnect handling.

Orca components are changed only where required for branding, Symphony domain
terms, capability checks or backend-neutral interfaces. Cosmetic
reinterpretation is out of scope.

### Codex shell

The current clean Codex-style session library, composer and compact
project/session navigation remain available as a parallel presentation. They
are moved behind a stable `codex` view boundary and consume the same shared
domain stores as the Orca shell.

The selected view is one device-wide preference:

```ts
type MobileViewMode = "orca" | "codex";
```

`orca` is the default. The preference is stored in AsyncStorage, not
SecureStore, because it is not secret. It is global to the application and is
not stored per host. A setting in the application switches modes. Switching
preserves the paired hosts and selected host, closes transient modals, and
navigates to the selected shell's home screen.

Deep links resolve first to a semantic target containing `host_id`, resource
kind and resource id. The active shell then maps that target to its own route.
Unsupported optional targets open the closest resource overview instead of
silently changing visual mode.

## Dev10x Brand and Product Language

`OrcaLogo` and Orca-specific assets are replaced with a Dev10x-branded
component using the existing Dev10x icon/logo. The app name, package display
name, splash, adaptive icon, settings/about identity and primary onboarding
headings use `Dev10x`. `Symphony host` remains the technical name for the
machine/runtime being paired and controlled.

Copied messages are rewritten without changing their behavioral purpose:

- "desktop" becomes "Symphony host" or "machine" where a remote host is meant;
- repository/worktree labels map to project/workspace only when the underlying
  Symphony object differs;
- agent, session, approval and terminal messages use Symphony terminology;
- troubleshooting text names Symphony RPC, host reachability, protocol and
  device pairing;
- no visible string, accessibility label, test id or notification copy refers
  to Orca or marine branding.

The first implementation keeps the language strategy already used by the
mobile application. Rebranding does not introduce a separate localization
framework.

## Backend Boundary

### Transport interface

`SymphonyHostTransport` is the only production backend implementation exposed
to copied UI code. It owns:

- direct connection to the selected Symphony host;
- X25519/HKDF/ChaCha20-Poly1305 handshake and encrypted authentication;
- per-device credential use and host-key pinning;
- version and capability negotiation;
- typed RPC requests, cancellation and deadlines;
- ordered stream subscriptions and cleanup;
- heartbeat, reconnect and normalized error states.

Orca screens and stores do not call REST, Phoenix Channels or a central
tracker. Any copied Orca transport call is either mapped to a typed Symphony
RPC method or hidden behind a negotiated capability. There is no automatic
wire fallback from a new RPC profile to legacy REST/Phoenix.

### Domain adapter

The domain adapter translates Symphony RPC DTOs to the stable view models
expected by the copied Orca stores and components. It keeps semantic
differences explicit:

| Orca concept | Symphony source |
| --- | --- |
| host | selected Symphony runtime |
| repository | project repository |
| worktree/workspace | Symphony workspace |
| session/tab | assistant or terminal session |
| agent | Symphony agent execution |
| account/usage | host capability and agent-provider usage |
| changes/history | workspace Git RPC |
| pull request/review | host pull-request RPC |

Missing optional capabilities produce the upstream disabled or unavailable
state. They do not receive fabricated data. Symphony-only metadata such as
tasks, blockers, subtasks, agent state, approvals and questions is added
through focused extensions that follow the copied Orca component patterns.

### Server implementation

Every selected Symphony host exposes the approved mobile WebSocket RPC
endpoint. Handlers reuse existing Symphony services for projects, workspaces,
sessions, agents, tasks, approvals, terminal, files, Git, pull requests,
previews and notifications. The mobile UI does not force duplicate business
rules into the client.

The web and desktop applications may continue using REST and Phoenix Channels
during migration. They share runtime services with RPC handlers, but the
mobile app never requires a central hub to control another host.

## Standalone Mock Server

The repository retains `npm run mock-server` and the external
Orca-shaped server structure:

- process and WebSocket lifecycle;
- server-side handshake/encryption;
- RPC handlers, deterministic fixtures and stream events;
- latency, method failure and disconnect controls;
- production-format pairing link.

The mock server runs outside the application. The app has no mock-only
navigation, alternate transport, hidden fixture mode or visual placeholder
screens. It uses the same `SymphonyHostTransport`, handshake, DTO parsers and
stores as a real host.

The mock exists for:

- fast screen construction and focused component work;
- deterministic loading, empty, error, offline and reconnect states;
- lightweight transport contract tests;
- reproducing UI bugs without starting agents, Git operations or full hosts.

Mock evidence is labeled `backend: mock`. It cannot close acceptance criteria
for Elixir persistence, real agent execution, filesystem, terminal, Git,
device revocation, host isolation or end-to-end security integration.

## Runtime and Error Behavior

Copied Orca loading, empty, confirmation and recovery experiences remain the
default presentation. Transport errors are normalized without leaking secrets:

- unreachable host → offline/retry experience plus diagnostics;
- reconnecting → retained cached state with stale indication;
- revoked device → pairing-required state;
- host-key mismatch → blocking security warning, never automatic acceptance;
- incompatible protocol → upgrade guidance using negotiated versions;
- unsupported capability → localized disabled/unavailable control;
- RPC timeout or retryable failure → upstream retry behavior;
- non-retryable mutation failure → retain input and show a clear result.

Tokens, pairing payloads, plaintext encrypted frames and private keys never
enter logs, screenshots, analytics or exported diagnostics.

## Migration Sequence

The implementation is divided into independently verifiable slices:

1. Record Orca provenance, license notices, compatible dependencies and make
   Dev10x the primary mobile brand.
2. Establish the shared core and `SymphonyHostTransport` contract without
   changing the approved RPC cryptography.
3. Import the Orca application shell, pairing and host dashboard; connect them
   to real host identity, health and project/workspace RPCs.
4. Connect sessions, chat, terminal, files and previews.
5. Connect changes, history, Git, pull requests and review.
6. Connect tasks, Symphony agent state, approvals, questions, notifications
   and usage through focused Orca-pattern extensions.
7. Place the existing Codex shell behind the device-wide view-mode setting and
   remove any duplicated connection ownership from it.
8. Align the standalone mock server with every required method while retaining
   real-host E2E as the release gate.
9. Capture Android local real-host E2E evidence; validate iOS on the user's Mac
   using the same real-host scenarios.

Source imports and mechanical renames are kept separate from RPC behavior
changes where practical, making future upstream comparison and code review
clearer.

## Validation Strategy

WSL validation is intentionally bounded. Full unit suites and broad
make-all-style routines are not release gates for this work.

Focused local validation includes:

- type-check and lint for touched mobile packages;
- targeted Orca-derived component/store tests;
- transport contract tests for copied call sites;
- fixed cryptographic vectors and handshake state-machine tests;
- mock-server smoke for deterministic UI construction;
- Android APK build when a native dependency or route slice changes;
- selected real-host Android E2E journeys with screenshots, trace and MP4.

The acceptance E2E uses at least two real local Symphony hosts and proves:

1. scan/manual pair and explicit confirmation;
2. per-device encrypted authentication;
3. host identity, health and switching;
4. project/workspace discovery and creation;
5. session/chat/agent activity, approvals and questions;
6. terminal, files and preview;
7. changes, Git and pull-request flows supported by the test repositories;
8. offline/reconnect behavior and host-state isolation;
9. Orca default shell and device-wide switch to/from the Codex shell.

The mock server may prepare UI development, but none of these acceptance items
passes solely from mock output.

## Acceptance Criteria

1. The default application experience is the copied Orca production flow, not
   a visual approximation.
2. Dev10x is the primary visible brand; Symphony is limited to runtime, host
   and RPC terminology; all visible Orca branding is removed while MIT
   attribution remains intact.
3. Copied frontend behavior changes only for branding, Symphony terminology,
   capability handling and the RPC/domain adapter.
4. The app pairs with and directly controls multiple real Symphony hosts using
   the approved per-device E2EE RPC architecture.
5. Orca-style onboarding, host dashboard, workspaces, sessions, terminal,
   files, source control, PR/review, diagnostics and responsive layouts remain
   operational where the selected host advertises support.
6. The Codex-style interface remains selectable as one global device
   preference and shares the same host, connection and data state.
7. `npm run mock-server` exercises the production client path and supports
   deterministic construction and focused tests.
8. Published E2E evidence is recorded against real local Symphony hosts and is
   explicitly distinguished from mock-server evidence.
9. No mandatory central tracker or hub is introduced.
10. Focused validation and local Android build/E2E complete without running
    heavy full test suites in WSL; iOS uses the same contract on the user's Mac.

## Explicit Non-Goals

- Recreating Orca screens from screenshots or visual mockups.
- Redesigning copied flows during the initial migration.
- Maintaining two transport stacks or two copies of domain state.
- Using the mock server as production or release acceptance evidence.
- Replacing the approved Symphony handshake with Orca's wire protocol.
- Making the visual preference host-specific.
- Introducing a mandatory remote build or central relay.
