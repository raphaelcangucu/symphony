# Agent session/orchestrator landing-page benchmark

**Date:** 2026-07-24
**Status:** Approved for direct execution by the operator
**Repository:** Symphony

## Problem

Symphony supports Codex, Cursor and Claude in interactive assistant sessions and
orchestrated issue runs, but the two execution paths have not been compared with
the same real task. A useful comparison must avoid provider-specific prompts,
shared writable workspaces and synthetic screenshots.

## Goal

Create one local Symphony project backed by a small seed Git repository and run
the same landing-page task six times:

| Execution path | Codex | Cursor | Claude |
| --- | --- | --- | --- |
| Interactive project session | one isolated workspace | one isolated workspace | one isolated workspace |
| Orchestrator issue | one isolated issue workspace | one isolated issue workspace | one isolated issue workspace |

Every run receives the byte-identical prompt. The prompt requires a complete
Symphony landing page, a preview-compatible dev command and Playwright E2E tests.
The experiment records Symphony UI video, screenshots, traces, provider/session
identity, output Git state, focused test results and a deterministic comparison
report.

## Considered approaches

### A. Direct provider CLI comparison

Run `codex`, `cursor-agent` and `claude` directly in six directories. This is
simple but does not test Symphony session state, routing, preview or orchestration,
so it cannot answer the operator's question.

### B. Synthetic backend harness

Call internal Elixir modules with fake runners and generate a demonstration page.
This is deterministic but does not prove real providers or the tracker UI.

### C. Real isolated Symphony instance and local project — selected

Start a dedicated Symphony instance with its own SQLite database, workspace root,
tracker token and preview port range. Register a local Git seed as a workspace
project, create three standalone session workspaces and three local issues, then
drive the real tracker UI and API. This is slower and consumes provider tokens,
but it exercises the contracts being evaluated without altering the operator's
normal Symphony database.

## Architecture

```
benchmark/prompt.md ───────────────┐
                                   ├── session: standalone workspace + assistant thread
local seed Git repository ─────────┤       ├── codex
                                   │       ├── cursor
                                   │       └── claude
                                   │
                                   └── orchestrator: local issue + isolated workspace
                                           ├── codex
                                           ├── cursor
                                           └── claude

dedicated Symphony (:4010)
  ├── dedicated SQLite database
  ├── dedicated workspace root
  ├── project workflow with one preview serve step
  └── Playwright tracker flow -> screenshot + video + trace

result collector
  ├── validates required files/scripts
  ├── runs each generated E2E spec sequentially
  ├── records duration/status/Git diff
  └── writes comparison.json + comparison.md
```

## Canonical landing-page prompt

The prompt is stored once in
`benchmarks/landing-page-agent-comparison/prompt.md`. Provisioning code reads the
file and sends its exact contents to both execution paths. It is never copied
into a provider branch.

The prompt fixes the stack and acceptance criteria sufficiently to make results
comparable while leaving visual execution to each agent:

- React, TypeScript and Vite;
- a responsive Portuguese landing page about Symphony;
- hero, workflow explanation, Codex/Cursor/Claude provider cards, evidence and
  CTA sections;
- semantic HTML, keyboard accessibility and reduced-motion support;
- `npm run dev -- --host 0.0.0.0` compatible with a Symphony preview lease;
- Playwright configuration and a focused landing-page spec;
- scripts for build and E2E;
- no questions, no unrelated services and no fabricated successful test claims.

## Local project contract

The benchmark provisions a runtime directory outside the Symphony Git checkout.
The seed is initialized as a Git repository and registered through the real
workspace-project API with a local clone URL. Its workflow:

- uses local tracker statuses `Backlog`, `In Progress`, `Human Review`, `Done`;
- dispatches only `In Progress`;
- accepts `codex`, `cursor` and `claude` per task/session;
- clones the seed into isolated workspaces;
- declares one `serve` step using `npm run dev`;
- declares focused unit/build and Playwright evidence commands;
- disables automatic publishing and external tracker mutations.

Runtime directories, provider transcripts and videos are experiment artifacts,
not PR source files.

## E2E flow

The tracker E2E uses a real `http://127.0.0.1:4010/tracker/...` URL and stores the
token in the same local-storage key used by the product. It:

1. opens each pre-provisioned session;
2. submits the canonical prompt through the visible composer;
3. waits for the durable assistant turn to finish;
4. captures the completed session and preview state;
5. opens each orchestrator issue and records status/progress/result;
6. writes named video and screenshot artifacts for the tracker flow.

The outer tracker trace is disabled because it can record the bearer token used
to authenticate local storage and API requests. Each generated landing still
must produce its own Playwright trace, which contains no tracker credential.

Provider generation is intentionally sequential on WSL. The E2E runner records
one path at a time and never launches a broad test matrix.

## Result comparison

The collector never assigns subjective design scores automatically. It records
comparable facts:

- completion status and wall-clock duration;
- generated file count and changed line count;
- presence of required page, config and E2E files;
- `npm install`, build and focused E2E outcome;
- preview readiness and URL;
- tracker screenshot/video paths and generated-E2E trace paths;
- provider conversation/run identity where available.

`comparison.md` links each output and leaves a compact human-review section for
visual quality, copy quality and maintainability.

## Failure handling

- Missing provider authentication is recorded as `blocked`, not converted into
  a fake pass or another provider.
- A provider failure remains associated with its cell in the six-run matrix.
- Preview and E2E failures are diagnosed within that generated workspace only.
- The harness does not fall back from a Symphony session to direct CLI.
- Timeouts stop only the affected run and preserve completed artifacts.
- The operator's existing database, daemon and dirty worktree are untouched.

## Acceptance criteria

1. One local project is visible in the dedicated Symphony instance.
2. The same prompt hash is recorded for all six runs.
3. Codex, Cursor and Claude are each attempted through session and orchestrator.
4. Generated projects are isolated from each other.
5. Preview configuration is present and exercised where generation succeeds.
6. The landing prompt explicitly requires Playwright E2E generation.
7. At least one real Symphony tracker flow has screenshot/video and its
   generated landing has a credential-free E2E trace.
8. A machine-readable and human-readable comparison is produced.
9. Only focused tests are run sequentially on WSL.

## Spec self-review

- No placeholder requirements remain.
- Direct CLI substitution is explicitly forbidden.
- Session and orchestrator paths share one prompt source.
- Runtime state is isolated from the operator's regular Symphony instance.
- Failures remain evidence instead of being hidden by fallbacks.
- Visual scoring is kept human-reviewed rather than presented as deterministic.
