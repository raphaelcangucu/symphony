# PR #7 Dev10x Mobile Comparison Design

## Context

PR #7 is the single delivery vehicle for Dev10x Mobile. PR #11 has been
absorbed into its branch and closed. The branch already contains direct
device-scoped encrypted RPC, multi-host pairing, rich chat, terminal, files,
diffs, previews, tasks, orchestrator streams, a real-host Android E2E, and the
existing six-cell landing-page benchmark harness and evidence.

The missing product flow is the ability to create and start that comparison
from the selected host inside the mobile app, observe all six real executions,
and inspect their previews and durable evidence without an out-of-band command.
The native splash and adaptive icon configuration are also incomplete.

## Decision

Add a first-class comparison coordinator behind encrypted mobile RPC. A
comparison is represented by an ordinary parent task and six ordinary child
tasks. The parent identifier is the comparison identifier. The coordinator
does not add a second orchestrator, a new tracker, or a parallel persistence
model.

The six canonical cells are:

| Path | Provider | Requested model | Requested effort |
| --- | --- | --- | --- |
| Session | Codex | `gpt-5.6-sol` | `high` |
| Session | Cursor | `cursor-grok-4.5-high` | provider-native high |
| Session | Claude | `claude-opus-5` | `high` |
| Orchestrator | Codex | `gpt-5.6-sol` | `high` |
| Orchestrator | Cursor | `cursor-grok-4.5-high` | provider-native high |
| Orchestrator | Claude | `claude-opus-5` | `high` |

Cursor's model carries the high setting in its model identifier, so the
persisted `effort` remains `nil` when required by the provider contract. The UI
still presents the effective effort as High and displays both requested and
resolved provenance.

## Alternatives considered

### Coordinate six independent tasks on the device

This would reuse existing HTTP-shaped task RPCs, but the phone would own
partial-failure recovery, idempotency, and launch ordering. Backgrounding the
app could strand a matrix and make its provenance depend on device state.

### Ask one orchestrator prompt to create and run the matrix

This is small but implicit. The resulting children, models, paths, and retry
behavior would depend on agent interpretation instead of a deterministic
contract.

### Add comparison-specific database tables

This would make querying direct, but duplicate state already persisted by
issues, parent relations, issue agent settings, assistant history, agent
executions, and evidence records. The extra lifecycle and migration surface is
not justified for the fixed six-cell product flow.

## Persistence and idempotency

The comparison coordinator derives state from existing authoritative records:

- the parent issue is the comparison root;
- six child issues are linked through the existing subtask relation;
- each child has the canonical provider/model/effort persisted in
  `IssueAgentSettings`;
- session cells have one canonical `issue_session` assistant thread;
- orchestrator cells have an `issue_execution` thread and agent execution;
- evidence remains in `Evidence.Store`;
- the parent and child activity streams record comparison lifecycle events.

Child identity is deterministic from path and provider. Starting the same
parent again reconciles the desired six cells: it reuses matching children and
threads, creates only missing records, and never replaces a native provider
conversation silently. A caller-supplied request key is recorded in activity
metadata. Repeating a completed request returns the same comparison snapshot.

If startup stops halfway through, the next `comparisons.start` call resumes
reconciliation. It does not duplicate children or dispatch terminal cells.
Explicit `comparisons.retry_cell` is required for a failed or timed-out cell.

## Backend components

`SymphonyElixir.MobileComparison.Contract` is the single source of truth for
the fixed matrix, stable cell identifiers, display labels, provider settings,
and validation.

`SymphonyElixir.MobileComparison.Service`:

1. validates that the selected project and parent issue exist;
2. reconciles the six child tasks and their settings;
3. creates/provisions the three isolated session threads;
4. starts their real turns through the existing assistant session service;
5. moves and dispatches the three autonomous children through the existing
   tracker/orchestrator path;
6. returns a snapshot derived from tasks, threads, executions, previews, and
   evidence;
7. implements explicit cell retry without silent conversation replacement.

`SymphonyElixir.MobileComparison.Presenter` normalizes the aggregate for mobile
without putting provider-specific rules in React Native.

`SymphonyElixir.MobileRpc.Methods.Comparisons` exposes:

- `comparisons.start`
- `comparisons.get`
- `comparisons.subscribe`
- `comparisons.retry_cell`

`SymphonyElixir.MobileRpc.Methods.Evidence` exposes:

- `evidence.list`
- `evidence.artifact.read`

`evidence.artifact.read` accepts project, issue, run, relative path, offset, and
bounded length. It uses `Evidence.Store.resolve_artifact/2`, rejects traversal
and symlinks, and returns a base64 chunk with MIME type, total size, next
offset, and EOF. All bytes remain inside the authenticated application-layer
encrypted RPC channel.

The comparison subscription composes existing task, assistant session, agent
execution, preview, and evidence events. It emits an initial snapshot and
coalesces subsequent updates into comparison snapshots. Reconnection creates a
new subscription and reloads authoritative state; clients do not replay stale
device events.

## Mobile experience

### Cold start and host

The app displays an official Dev10x splash on the native dark background, then
opens the existing clean host/session experience. App icons use dedicated iOS,
Android legacy, and Android adaptive-safe assets generated from the canonical
files in `tracker/public`. The adaptive foreground keeps the brand mark inside
the platform safe zone.

The selected paired host remains visible in the comparison flow. All calls use
that host's encrypted RPC client. Switching hosts cannot leak or reuse a
comparison snapshot from another host.

### Create and dispatch

The existing New Task form gains a comparison option. Selecting it fixes the
official six-cell contract and shows the three providers, two paths, and High
effort before creation. Creating the task first creates only the parent. The
user then taps `Run comparison` on its detail screen; this explicit action
calls `comparisons.start`.

This preserves visible proof of both required actions:

1. create a task in the app;
2. dispatch its comparison to the selected Symphony host in the app.

### Comparison screen

The parent detail opens one comparison surface with five sections:

- **Overview** — parent task, selected host, `n/6` progress, elapsed time,
  requested matrix, failures, and recovery state;
- **Runs** — six cards with path, provider, requested/resolved model and effort,
  status, attempt, thread/execution identity, latest message, and actions to
  open the rich log or retry an eligible cell;
- **Previews** — real dev-server previews grouped by cell, using the existing
  preview surface;
- **Evidence** — durable records grouped by cell and run, with screenshots,
  videos, traces, reports, proof, commands, durations, and pass/block/fail
  status;
- **Decision** — deterministic audit totals, ranking, and the final comparison
  decision generated from the completed run results.

Session and orchestrator logs open in the same rich chat design already used by
PR #7. Terminal remains an action inside the chat; it is not the default
surface.

### Artifact viewing

The app downloads evidence artifacts incrementally through encrypted RPC into
an app-cache file whose key includes host, issue, run, path, and content
identity. Screenshots open in the native image viewer. Videos open in an
in-app native video player. Text reports and JSON open in the existing
formatted file preview. Trace ZIP files show metadata and can be shared or
saved, but are not interpreted as HTML inside the app.

Cached evidence is scoped by host and cleared on device revocation/sign-out.

## State and failure behavior

- Offline hosts show the existing reconnect state and preserve the last
  explicitly labeled cached snapshot.
- A reconnect reloads `comparisons.get` before resubscribing.
- Authentication, protocol incompatibility, and host reachability remain
  distinct actionable errors.
- A cell cannot be retried while live or after verified success.
- A failed native resume remains parked until the user chooses the existing
  explicit hard-reset path; comparison retry does not erase provenance.
- Partial comparison startup reports which cells were reconciled and which
  failed. Repeating Start resumes only the incomplete startup work.
- Parent progress is derived from the six cells, never inferred from a timer.
- Ranking is unavailable until all six cells reach a terminal state and every
  claimed visual result has durable evidence.

## Ranking and decision

Reuse the benchmark collector's audit vocabulary and comparison inputs:

- agent outcome and terminal state;
- requested/resolved provider provenance;
- build and E2E results;
- screenshots, videos, traces, reports, and navigation proof;
- preview availability;
- recovery attempts and terminal errors.

The backend produces normalized cell metrics. The existing comparison
collector remains the canonical formatter for the detailed report and decision
artifacts, but is invoked by the host-side comparison service rather than by a
human shell command. The app is the sole start trigger for official evidence.
No web tracker automation is used to create or dispatch the six cells.

## Test strategy

All behavior changes follow test-first development.

Focused Elixir tests cover:

- canonical matrix contract and provider-specific effort;
- idempotent reconciliation and recovery after each partial-start boundary;
- session creation/turn start and autonomous dispatch through existing
  services;
- snapshot provenance, progress, and terminal decision gating;
- subscription isolation and reconnect snapshots;
- evidence listing, bounded chunk reads, MIME metadata, EOF, traversal,
  symlink, unknown run, and unknown artifact errors.

Focused mobile tests cover:

- comparison task creation and explicit dispatch;
- host-scoped query/cache keys;
- six-cell overview and provenance rendering;
- live updates, offline state, retry eligibility, and decision gating;
- evidence grouping, chunk download/resume, screenshot/video/report viewers,
  and cache isolation;
- native configuration references for splash and all icon variants.

The official Android E2E runs against a real local Symphony host and real
providers. It records one continuous flow:

`Dev10x splash → select host → create comparison task → Run comparison → six
live cells → session and orchestrator logs → previews → screenshots/video/trace
evidence → ranking and decision`.

The E2E produces a redacted RPC trace, principal screen captures, the complete
video, media SHA-256 values, provider versions, requested/resolved provenance,
cell timing, retry/recovery details, and a requirement audit. It does not use
the mock server or an out-of-band dispatch command.

Only focused tests, targeted builds, and the directed E2E run locally in WSL.
The complete heavy unit suite remains outside this local workflow.

## Delivery

All implementation, evidence, and PR narrative stay on PR #7. The PR
description is updated with the detailed six-cell matrix, audit counts, inline
mobile screenshots, the continuous mobile video, evidence links,
failures/recoveries, and the final decision. PR #11 remains closed and is not a
delivery reference.
