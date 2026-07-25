# Agent benchmark perfect-execution corrective design

Status: approved for direct execution by the user on 2026-07-24.

## Goal

Run the same Symphony landing-page task through interactive sessions and the
orchestrator with Codex, Cursor, and Claude. Every cell must complete without a
provider/session error, produce a buildable page and focused E2E result, and
publish durable desktop/mobile screenshots plus an MP4 walkthrough in the
issue Evidence tab.

## Root causes

1. Cursor ACP received entries copied from `.cursor/mcp.json`. Cursor's native
   workspace configuration and ACP `session/new.mcpServers` are different
   contracts. The native file is loaded by Cursor itself; reshaping its entries
   into incomplete ACP objects causes `invalid_union`.
2. Orchestrator runs were configured for only five outer turns and the task
   prompt did not describe the workpad, evidence, commit, and local publish
   lifecycle. Codex exhausted the turn budget, while Cursor and Claude were
   interrupted before satisfying the handoff contract. A stale-activity
   heuristic also labeled any recent tool activity without a completed turn as
   `aborted`, even while the worker remained present. The benchmark trusted
   that contradictory execution status while its thread was still active.
3. Every generated Playwright project defaulted to port 4173 and permitted
   reuse of an existing server. A cell could therefore validate another cell's
   page. Generated selectors were also allowed to be ambiguous.
4. Standardized captures ran after the orchestrator persistence point, lived
   outside `.symphony/evidence`, omitted mobile and MP4, and had no issue-bound
   persistence path for interactive sessions.

## Design

### Cursor MCP

Keep `.cursor/mcp.json` as the single native Cursor MCP configuration. Send an
empty, required `mcpServers` array through ACP so Cursor loads the workspace
file once. Do not introduce a translation fallback or duplicate fields.

### Run lifecycle

Provision one local issue per matrix cell. Interactive cells use an
`issue_session` thread without dispatching the issue; orchestrator cells use
the normal `issue_execution` thread.

Use one canonical task prompt for all six cells. It must:

- allow the root evidence manifest in addition to `site/`;
- require exact accessible selectors and a generated E2E that never reuses an
  unknown server;
- use `PLAYWRIGHT_BASE_URL` and `PORT`, with 4173 only as a developer default;
- explain that the orchestrator must update the workpad, validate, commit, push
  to the configured local origin, and leave the issue ready for handoff.

Raise the benchmark turn limit to the product default of 30. Keep execution
sequential and assign deterministic isolated ports per cell.

An execution still present in the orchestrator snapshot may become `idle` after
the freshness window, but it is aborted only by an explicit abort/run-failure
event. Benchmark settlement requires the matching thread and execution to both
be terminal; an `aborted` execution paired with an active thread is not settled.

### Canonical evidence

The benchmark-owned capture is authoritative and independent of provider test
implementation:

- desktop viewport 1280x720, full-page PNG;
- mobile viewport 390x844, full-page PNG;
- a real HTTP walkthrough recorded by Playwright;
- WebM source retained and MP4/H.264 (`yuv420p`, fast-start) derived with
  `ffmpeg`;
- trace retained when the generated test creates one.

Artifacts are staged below each workspace's `.symphony/evidence/`, and the
manifest records real commands, navigation, labeled screenshots, both video
formats, and proof metadata. Capture owns a unique preview process group and
always tears it down; it never reuses port 4173.

Add an authenticated thread-evidence import endpoint. It accepts only a thread
id, derives the project, issue, and workspace on the server, reads the validated
manifest from that owned workspace, and persists it with the thread id as the
session id. It accepts no client filesystem path. Both `issue_session` and
`issue_execution` are supported, which makes the same post-run import usable
for all six cells.

### Evidence skill

The Evidence skill must require full-page desktop and mobile screenshots for
UI pages and a browser-compatible MP4 copy of each E2E walkthrough. WebM remains
the immutable recorder output; MP4 is an explicit derived artifact. The final
manifest must reference the files that should appear in the Evidence tab.

## Failure semantics

No fallback may convert a failed provider, build, E2E, capture, transcode,
manifest validation, import, or artifact fetch into success. Each cell records
the exact failed stage. Collection proceeds to later cells, but the final
comparison is passing only when all stages pass for every cell.

## Verification

Use focused tests only:

- Cursor ACP runner test;
- Evidence controller import tests;
- benchmark Node contract/collector/capture tests;
- targeted format/spec checks for touched Elixir files.

Then use a fresh isolated runtime and run the six cells sequentially. For each
cell verify the page build, focused generated E2E, full-page PNG dimensions,
MP4 codec/decode, evidence API listing, and authenticated artifact download.
