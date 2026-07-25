# Session Model Provenance and Benchmark Matrices Implementation Plan

> Execute every code change test-first and run only the focused commands listed
> below, sequentially.

**Goal:** Persist requested and provider-resolved session model provenance,
remove duplicate legacy metadata and synthetic model fallbacks, expose the
contract in the UI, and run reproducible default, advanced, and Codex 5.6
benchmark matrices with complete Evidence artifacts.

**Architecture:** `assistant_threads` owns four canonical model provenance
columns. Provider adapters emit native resolution data, `AgentSession` persists
it, and API/channel presenters expose it. Benchmark cells carry explicit matrix
configuration and fail when resolution evidence is absent.

**Stack:** Elixir/Ecto/Phoenix, TypeScript/React/Vitest, Node.js test runner,
Playwright, FFmpeg, SQLite.

---

## Task 1: Canonical Database Contract

**Files:**

- Create:
  `elixir/priv/repo/migrations/20260725010000_add_model_provenance_to_assistant_threads.exs`
- Modify: `elixir/lib/symphony_elixir/assistant/thread.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/history.ex`
- Test: `elixir/test/symphony_elixir/assistant/history_agent_fields_test.exs`
- Test: `elixir/test/symphony_elixir/assistant/turn_history_test.exs`

1. Add failing schema/history tests for four fields, trimmed input, absence of
   metadata duplicates, and explicit resolved provenance updates.
2. Run:
   `mix test test/symphony_elixir/assistant/history_agent_fields_test.exs
   test/symphony_elixir/assistant/turn_history_test.exs`
   and confirm the new assertions fail.
3. Add the four schema fields and canonical history helpers.
4. Change all session creation paths to write requested fields directly.
5. Remove model/effort from new `current_turn` metadata.
6. Implement a migration that backfills only requested legacy values, removes
   both top-level and current-turn duplicates, and leaves resolved fields null.
7. Re-run the focused tests.

## Task 2: Public API and Channel Contract

**Files:**

- Modify:
  `elixir/lib/symphony_elixir_web/presenters/tracker_presenter.ex`
- Modify:
  `elixir/lib/symphony_elixir_web/controllers/tracker/assistant_thread_controller.ex`
- Modify:
  `elixir/lib/symphony_elixir_web/channels/assistant_channel.ex`
- Test:
  `elixir/test/symphony_elixir_web/controllers/tracker/assistant_thread_controller_test.exs`
- Test:
  `elixir/test/symphony_elixir_web/channels/assistant_channel_test.exs`

1. Add failing controller and join-payload assertions for the four fields.
2. Run the two test files with focused `mix test` line filters when practical.
3. Replace metadata writes and legacy `model`/`effort` payload fields with the
   canonical requested/resolved contract.
4. Re-run the focused tests.

## Task 3: Provider-Native Resolution

**Files:**

- Modify: `elixir/lib/symphony_elixir/codex/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir/claude/app_server/cli_runner.ex`
- Modify: `elixir/lib/symphony_elixir/claude/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir/cursor/coding_agent.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/agent_session.ex`
- Modify: related provider event normalization modules
- Test: focused coding-agent/CLI-runner/agent-session test files

1. Add failing tests proving:
   - Codex retains `thread/start`/`thread/resume` model and effort and handles
     `model/rerouted`;
   - Claude retains `system/init.model`;
   - Cursor canonicalizes the unique `system/init.model` catalog label;
   - `AgentSession` persists provider resolution.
2. Run only those provider test files and confirm the new failures.
3. Add one provider-neutral resolution event/result contract.
4. Persist resolved values after native confirmation; never infer a missing
   resolved model from requested values.
5. Re-run focused provider tests.

## Task 4: Current Model Catalogs Without Synthetic Fallbacks

**Files:**

- Modify: `elixir/lib/symphony_elixir/codex/model_catalog.ex`
- Modify: `elixir/lib/symphony_elixir/claude/model_catalog.ex`
- Modify: `elixir/lib/symphony_elixir/cursor/model_catalog.ex`
- Modify: `elixir/lib/symphony_elixir/assistant/catalog_bundle.ex`
- Test: corresponding model-catalog tests

1. Add failing tests that catalog failures return errors rather than stale
   synthetic entries.
2. Add failing Claude assertions for `claude-sonnet-5` and
   `claude-opus-5`.
3. Implement the live error behavior and current curated Claude catalog.
4. Re-run only catalog tests.

## Task 5: Session Model Provenance UI

**Files:**

- Modify: `tracker/src/types/assistant-thread.ts`
- Modify: `tracker/src/services/assistantThreads.ts`
- Modify:
  `tracker/src/components/assistant/AssistantPanelHeader.tsx`
- Modify:
  `tracker/src/components/assistant/ProjectAssistantPanel.tsx`
- Test: focused service and component tests

1. Add failing normalization tests for all four DTO fields.
2. Add failing header tests for confirmed, pending, and rerouted states.
3. Implement a small typed provenance object and deterministic label.
4. Feed join/API provenance into the header; remove the catalog command as the
   alleged session model.
5. Run targeted Vitest files serially.

## Task 6: Explicit Benchmark Matrices

**Files:**

- Modify:
  `benchmarks/landing-page-agent-comparison/src/contract.mjs`
- Modify:
  `benchmarks/landing-page-agent-comparison/src/provision.mjs`
- Modify:
  `benchmarks/landing-page-agent-comparison/src/run-cell.mjs`
- Modify:
  `benchmarks/landing-page-agent-comparison/src/collect.mjs`
- Modify:
  `benchmarks/landing-page-agent-comparison/package.json`
- Modify/create focused benchmark tests

1. Add failing Node tests for 6 default cells, 6 advanced cells, and 3 Codex
   5.6 cells.
2. Add failing tests that provisioning forwards model/effort to direct sessions
   and issue settings.
3. Add failing collector tests for missing/mismatched requested or resolved
   provenance.
4. Implement the matrix contract and namespaced run IDs.
5. Run `npm test` inside the benchmark directory only.

## Task 7: Focused Verification and Migration Safety

1. Run `mix format --check-formatted` only on changed Elixir files.
2. Run the focused Elixir test files sequentially.
3. Run focused tracker Vitest files sequentially.
4. Run benchmark Node tests.
5. Apply the migration to a disposable copied SQLite database containing legacy
   metadata and query it to prove:
   - requested values backfilled;
   - resolved values not fabricated;
   - legacy JSON keys removed.
6. Run `git diff --check`.

## Task 8: Execute Benchmarks and Capture Evidence

1. Verify the local Symphony daemon, agent authentication, browser dependencies,
   and FFmpeg.
2. Provision and execute all 15 cells sequentially.
3. For every generated page, run its focused E2E test and capture:
   - desktop full-page PNG;
   - mobile full-page PNG;
   - WebM;
   - H.264/yuv420p fast-start MP4;
   - Playwright trace.
4. Persist artifacts with the Evidence workflow and re-read the Evidence records.
5. Fail the matrix/report if any artifact or resolved provenance is absent.

## Task 9: Reports, Review, and PR

1. Update comparison Markdown/JSON with requested and resolved model/effort,
   timings, test results, artifact links, and failures.
2. Run a focused code review against the design and acceptance criteria.
3. Fix any review findings and repeat their targeted checks.
4. Commit implementation and evidence in coherent commits.
5. Push `codex/pr6-agent-e2e`.
6. Update PR #6 description with reports, screenshots, and MP4 links.
7. Re-read PR state and checks to confirm the published handoff.
