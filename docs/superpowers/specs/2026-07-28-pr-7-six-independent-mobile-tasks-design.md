# PR #7 Six Independent Mobile Tasks Design

## Status

This design supersedes the comparison-product portions of
`2026-07-27-pr-7-dev10x-mobile-comparison-design.md`.

The six-run comparison is validation performed by the PR's E2E harness. It is
not a Symphony or Dev10x Mobile product concept.

## Correction

PR #7 must not create, display, persist, dispatch, or subscribe to a comparison
task, comparison parent, comparison aggregate, comparison decision, or fixed
comparison matrix.

The validation run creates six ordinary top-level tasks through the app:

| Execution path | Agent | Requested model | Requested effort |
| --- | --- | --- | --- |
| Session | Codex | `gpt-5.6-sol` | `high` |
| Session | Cursor | `cursor-grok-4.5-high` | provider-native high |
| Session | Claude | `claude-opus-5` | `high` |
| Orchestrator | Codex | `gpt-5.6-sol` | `high` |
| Orchestrator | Cursor | `cursor-grok-4.5-high` | provider-native high |
| Orchestrator | Claude | `claude-opus-5` | `high` |

Each task is independently visible in the normal project task list and has its
own identifier, status, agent settings, session or execution identity,
workspace, logs, preview, artifacts, and evidence. There is no parent/child
relationship between these six tasks.

## Product boundary

Dev10x Mobile provides generic operations only:

- create one ordinary task;
- choose and persist that task's agent, model, and effort;
- open a task as a rich assistant session and send its prompt;
- dispatch a task through the normal Symphony orchestrator;
- observe the selected task's status and activity;
- open that task's session or orchestrator log;
- inspect that task's terminal, files, diffs, Git/PR state, previews, and
  durable evidence.

The app must not contain:

- a `Dev10x comparison` task type;
- a fixed six-cell matrix;
- comparison markers embedded in descriptions or titles;
- `Run comparison`, `Open comparison`, retry-cell, ranking, or decision UI;
- comparison-specific mobile RPC methods, subscriptions, presenters, services,
  event buses, or persistence;
- comparison-specific mock-server state.

Generic evidence RPC and viewers remain because they are useful for every
ordinary task. Generic rich chat, orchestrator logs, and the terminal remain
part of the product.

## App-driven validation

The E2E harness is the only comparison coordinator. It operates the same
visible app controls a user uses and records the resulting identifiers.

For each of the three session cells, the E2E:

1. creates a new top-level task in the selected project;
2. selects the requested agent, model, and effective effort;
3. opens the task's rich session;
4. sends the common site-building prompt;
5. follows the real session log until a terminal outcome;
6. opens the task's terminal, preview, and evidence.

For each of the three orchestrator cells, the E2E:

1. creates a new top-level task in the selected project;
2. selects the requested agent, model, and effective effort;
3. dispatches that task through the normal orchestrator action;
4. follows the real orchestrator execution log until a terminal outcome;
5. opens the task's terminal, preview, and evidence.

The harness may keep a local manifest mapping the six test cell names to their
real task, session, execution, preview, and evidence identifiers. That
manifest and the generated comparison report are test artifacts only. They are
not sent to or reconstructed by product code.

## Task detail and observability

An ordinary task detail is the common entry point for both execution paths.
It exposes:

- task status and configured agent/model/effort;
- `Open session` for its rich chat;
- `Dispatch`/`Continue agent` for orchestrator work;
- the activity/session log appropriate to the task;
- terminal, preview, files, diff, and pull-request actions;
- a generic evidence section listing the task's runs and artifacts.

Session tasks open the rich chat by default. The terminal is an explicit action
inside the task/session experience, never the default replacement for chat.
Orchestrator tasks expose the orchestrator execution timeline and link to the
same task-scoped tools and evidence.

Evidence and logs are always queried with the ordinary task identifier and the
selected host. Switching hosts must invalidate task-scoped caches and cannot
mix artifacts between machines.

## Evidence experience in the app

Evidence is a first-class, generic part of every task rather than a
comparison-only gallery.

### Task summary

The task detail contains an **Evidence** section after the execution summary.
Its compact state shows:

- the latest run status (`passed`, `blocked`, `failed`, or `collecting`);
- when evidence was last updated;
- counts for screenshots, videos, traces, and reports;
- requested and resolved agent/model/effort provenance;
- an `Open evidence` action.

While an execution is live, the section updates through the task-scoped stream.
An empty state explains that artifacts appear after the session or
orchestrator publishes evidence. A failed load has an explicit retry action and
does not hide the rest of the task.

### Task evidence screen

`Open evidence` navigates to a route scoped only by selected host, project, and
ordinary task identifier. It never requires a comparison cell or parent
identifier.

The screen groups records by real execution/session run. Each run presents:

- execution path (`Session` or `Orchestrator`);
- run/session/execution identifier and attempt;
- start, finish, and elapsed time;
- agent plus requested and resolved model/effort;
- final state and validation summary;
- commands and focused checks that were run;
- navigation proof and preview URL when present;
- artifact groups for screenshots, videos, text/JSON reports, and traces.

The latest run is expanded initially. Previous attempts remain accessible so a
retry never erases provenance. The task screen links directly to its rich
session log or orchestrator execution log from the corresponding run.

### Artifact viewers

Artifact behavior remains native:

- screenshots open in a zoomable image viewer;
- videos open in an in-app player with play/pause, seek, elapsed/duration, mute,
  fullscreen, and stable controls;
- Markdown, text, command logs, and JSON open in the formatted file viewer;
- trace archives show metadata and can be shared or saved without executing
  embedded HTML.

Downloads use bounded encrypted RPC chunks and show progress, cancellation,
retry, and integrity errors. Cached files are keyed by host, task, run,
artifact path, and content identity. Revoking/signing out a device clears its
evidence cache.

### Logs and provenance

Evidence complements logs; it does not replace them. Every evidence run has:

- `Open session log` for session-driven work;
- `Open orchestrator log` for orchestrator-driven work;
- `Open terminal` for the task workspace;
- `Open preview` when a real preview is available.

The app labels stale cached evidence when the host is offline. Reconnection
reloads authoritative task evidence before resubscribing. Evidence from a
different host, task, or attempt must never be merged into the current screen.

## Removal and compatibility

Remove the comparison-specific React Native feature, routes, description
markers, RPC client, backend RPC allowlist, coordinator modules, tests, and
mock-server fixtures introduced on PR #7.

Existing generic task, session, orchestrator, preview, terminal, and evidence
implementations are retained. No migration is required for production data
because the comparison implementation is unmerged PR code. Any comparison
parent tasks created during development are treated as ordinary tasks after
the marker parser is removed; the official E2E creates a fresh project/run and
does not reuse them.

## Test strategy

Changes follow focused test-driven development:

- creation tests assert that New Task creates exactly one ordinary top-level
  task and contains no comparison option;
- task-detail tests assert generic session, orchestrator, terminal, preview,
  and evidence actions without comparison detection;
- evidence-screen tests assert task-scoped run grouping, provenance, log
  routing, loading/empty/offline/error states, and preservation of attempts;
- artifact tests cover image/video/report/trace viewers, download progress,
  cancellation, retry, cache isolation, and integrity failures;
- dispatcher tests assert that comparison RPC methods are unavailable;
- backend tests retain generic evidence access and remove coordinator coverage;
- mock-server tests cover only generic task/session/orchestrator/evidence
  behavior;
- the directed Android E2E creates all six tasks through the app against a
  real local Symphony host.

The final E2E evidence must show:

1. all six distinct task identifiers in the app;
2. three real rich session logs;
3. three real orchestrator execution logs;
4. each task's requested and resolved model/effort provenance;
5. terminal usage without flicker or layout corruption;
6. previews and task-scoped screenshots/videos/reports;
7. the external comparison report generated from the six captured task
   results.

Only focused tests, targeted builds, and the directed E2E run locally in WSL.
The full heavy unit suite remains outside the local workflow.

## Delivery

PR #7 remains the only delivery reference. Its description and Gist must stop
describing comparison as a product feature. They instead document the six
independent tasks as E2E validation, with links to the real task evidence,
session logs, orchestrator logs, screenshots, and final continuous app video.
