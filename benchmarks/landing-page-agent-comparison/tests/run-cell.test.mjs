import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactSlug,
  attemptArtifactPath,
  attemptSlug,
  benchmarkResultStatus,
  classifySessionOutcome,
  issueRoute,
  issueStatusName,
  classifyOrchestratorOutcome,
  isTerminalAgentExecution,
  isTerminalExecutionThread,
  isSettledOrchestratorExecution,
  selectRun,
  selectIssueAgentExecution,
  selectIssueExecutionThread,
  sessionRoute,
  sessionFailureSummary,
  sessionProviderError,
  sessionTurnObserved,
  shouldDispatchIssue,
} from "../src/run-cell.mjs";

const manifest = {
  project_slug: "symphony-landing-benchmark",
  runs: [
    {
      id: "session-codex",
      path: "session",
      provider: "codex",
      thread_id: 41,
    },
    {
      id: "orchestrator-claude",
      path: "orchestrator",
      provider: "claude",
      issue_identifier: "SYM-6",
    },
  ],
};

test("selectRun resolves exactly one canonical matrix cell", () => {
  assert.equal(selectRun(manifest, "session-codex").thread_id, 41);
  assert.throws(() => selectRun(manifest, "missing"), /unknown benchmark run/);
});

test("artifactSlug accepts only safe canonical run identifiers", () => {
  assert.equal(
    artifactSlug("providers-default-orchestrator-claude"),
    "providers-default-orchestrator-claude",
  );
  assert.equal(
    artifactSlug("codex-5.6-defaults-session-sol"),
    "codex-5.6-defaults-session-sol",
  );
  assert.throws(() => artifactSlug("../../escape"), /invalid benchmark run id/);
});

test("attempt artifacts are immutable and path-safe", () => {
  assert.equal(
    attemptSlug("20260724T120000000Z-a1b2c3"),
    "20260724T120000000Z-a1b2c3",
  );
  assert.throws(() => attemptSlug("../latest"), /invalid benchmark attempt id/);
  assert.equal(
    attemptArtifactPath(
      "/tmp/runtime",
      "providers-default-orchestrator-claude",
      "attempt-01",
    ),
    "/tmp/runtime/artifacts/providers-default-orchestrator-claude/attempts/attempt-01",
  );
});

test("tracker routes target the real session and issue surfaces", () => {
  assert.equal(
    sessionRoute(manifest.project_slug, 41),
    "/tracker/projects/symphony-landing-benchmark/workspaces/41",
  );
  assert.equal(
    issueRoute(manifest.project_slug, "SYM-6"),
    "/tracker/projects/symphony-landing-benchmark/board/issues/SYM-6/sessions?surface=autonomous",
  );
});

test("session outcome requires provider response and matching model provenance", () => {
  const healthyThread = {
    agent_kind: "codex",
    status: "active",
    metadata: {},
    requested_model: "gpt-5.6-sol",
    requested_effort: "low",
    resolved_model: "gpt-5.6-sol",
    resolved_effort: "low",
  };
  const run = {
    provider: "codex",
    requested_model: "gpt-5.6-sol",
    requested_effort: "low",
  };
  assert.equal(classifySessionOutcome(0, 1, healthyThread, run), "completed");
  assert.equal(classifySessionOutcome(0, 0, healthyThread, run), "failed");
  assert.equal(
    classifySessionOutcome(
      0,
      1,
      {
        ...healthyThread,
        status: "error",
      },
      run,
    ),
    "failed",
  );
  assert.equal(
    classifySessionOutcome(0, 1, healthyThread, { ...run, provider: "claude" }),
    "failed",
  );
  assert.equal(
    classifySessionOutcome(
      0,
      1,
      { ...healthyThread, resolved_model: null },
      run,
    ),
    "failed",
  );
  assert.equal(
    classifySessionOutcome(
      0,
      1,
      { ...healthyThread, resolved_model: "gpt-5.6-terra" },
      run,
    ),
    "failed",
  );
});

test("session turn observation survives virtualized chat message counts", () => {
  const thread = {
    agent_kind: "cursor",
    status: "active",
    metadata: {},
    requested_model: "composer-2.5",
    requested_effort: null,
    resolved_model: "composer-2.5",
    resolved_effort: null,
    updated_at: "2026-07-25T17:50:11Z",
  };
  const run = {
    provider: "cursor",
    requested_model: "composer-2.5",
    requested_effort: null,
    initial_thread_updated_at: "2026-07-25T17:49:17Z",
  };

  assert.equal(sessionTurnObserved(2, 2, thread, run), true);
  assert.equal(classifySessionOutcome(2, 2, thread, run), "completed");
  assert.equal(
    sessionTurnObserved(2, 2, thread, {
      ...run,
      initial_thread_updated_at: thread.updated_at,
    }),
    false,
  );
});

test("benchmark result cannot complete while a contract error is present", () => {
  const completed = {
    agent_outcome: "completed",
    identity: { provider_matches: true },
    error: null,
  };

  assert.equal(benchmarkResultStatus(completed), "completed");
  assert.equal(
    benchmarkResultStatus({
      ...completed,
      error: "model provenance mismatch",
    }),
    "blocked",
  );
  assert.equal(
    benchmarkResultStatus({
      ...completed,
      identity: { provider_matches: false },
    }),
    "blocked",
  );
});

test("session outcome requires Cursor's catalog-canonical model confirmation", () => {
  assert.equal(
    classifySessionOutcome(
      0,
      1,
      {
        agent_kind: "cursor",
        status: "active",
        metadata: {},
        requested_model: "composer-2.5",
        requested_effort: null,
        resolved_model: "composer-2.5",
        resolved_effort: null,
      },
      {
        provider: "cursor",
        requested_model: "composer-2.5",
        requested_effort: null,
      },
    ),
    "completed",
  );

  assert.equal(
    classifySessionOutcome(
      0,
      1,
      {
        agent_kind: "cursor",
        status: "active",
        metadata: {},
        requested_model: "cursor-grok-4.5-high",
        requested_effort: null,
        resolved_model: "cursor-grok-4.5-high",
        resolved_effort: null,
      },
      {
        provider: "cursor",
        requested_model: "cursor-grok-4.5-high",
        requested_effort: null,
      },
    ),
    "completed",
  );

  assert.equal(
    classifySessionOutcome(
      0,
      1,
      {
        agent_kind: "cursor",
        status: "active",
        metadata: {},
        requested_model: "composer-2.5",
        requested_effort: null,
        resolved_model: "composer-2.5[fast=true]",
        resolved_effort: null,
      },
      {
        provider: "cursor",
        requested_model: "composer-2.5",
        requested_effort: null,
      },
    ),
    "failed",
  );

  assert.equal(
    classifySessionOutcome(
      0,
      1,
      {
        agent_kind: "cursor",
        status: "active",
        metadata: {},
        requested_model: "cursor-grok-4.5-high",
        requested_effort: "high",
        resolved_model: "cursor-grok-4.5-high",
        resolved_effort: "high",
      },
      {
        provider: "cursor",
        requested_model: "cursor-grok-4.5-high",
        requested_effort: "high",
      },
    ),
    "failed",
  );
});

test("session failure summary reports model provenance mismatches explicitly", () => {
  const run = {
    provider: "codex",
    requested_model: "gpt-5.5",
    requested_effort: "medium",
  };
  const thread = {
    agent_kind: "codex",
    status: "active",
    metadata: {},
    requested_model: "gpt-5.5",
    requested_effort: "medium",
    resolved_model: "gpt-5.6-sol",
    resolved_effort: "high",
  };

  assert.equal(
    sessionFailureSummary(0, 1, thread, run),
    "model provenance mismatch: requested gpt-5.5/medium, resolved gpt-5.6-sol/high",
  );
});

test("issue status normalizes tracker string and presenter object shapes", () => {
  assert.equal(issueStatusName({ status: "Human Review" }), "Human Review");
  assert.equal(
    issueStatusName({ status: { name: "In Progress", category: "active" } }),
    "In Progress",
  );
});

test("orchestrator capture resumes active and completed issues without resetting them", () => {
  assert.equal(shouldDispatchIssue({ status: "Backlog" }), true);
  assert.equal(shouldDispatchIssue({ status: { name: "In Progress" } }), false);
  assert.equal(
    shouldDispatchIssue({ status: { name: "Human Review" } }),
    false,
  );
  assert.equal(shouldDispatchIssue({ status: "Done" }), false);
  assert.equal(shouldDispatchIssue({ status: { category: "unknown" } }), false);
});

test("session provider errors preserve the ACP contract failure without a fallback", () => {
  assert.deepEqual(
    sessionProviderError({
      metadata: {
        current_turn: {
          error:
            '%{"data" => [%{"code" => "invalid_union", "path" => ["mcpServers", 0]}]}',
          error_code: "agent_operation_failed",
          error_detail: {
            category: "internal",
            message: "The agent operation failed.",
            retryable: false,
          },
        },
      },
    }),
    {
      code: "agent_operation_failed",
      category: "internal",
      retryable: false,
      summary: "Cursor ACP rejected mcpServers payload (invalid_union)",
      raw: '%{"data" => [%{"code" => "invalid_union", "path" => ["mcpServers", 0]}]}',
    },
  );
  assert.equal(sessionProviderError({ metadata: {} }), null);
});

test("orchestrator outcome requires a closed provider execution thread", () => {
  const threads = [
    {
      id: 10,
      scope: "issue_execution",
      issue_identifier: "SYM-1",
      agent_kind: "codex",
      status: "error",
    },
    {
      id: 11,
      scope: "issue_execution",
      issue_identifier: "SYM-2",
      agent_kind: "claude",
      status: "closed",
    },
  ];

  assert.equal(selectIssueExecutionThread(threads, "SYM-2").id, 11);
  assert.equal(
    classifyOrchestratorOutcome(threads[0], {
      status: "aborted",
      execution_session_id: 10,
    }),
    "failed",
  );
  assert.equal(
    classifyOrchestratorOutcome(threads[1], {
      status: "saved",
      execution_session_id: 11,
    }),
    "completed",
  );
  for (const status of ["aborted", "failed", "error", "canceled"]) {
    assert.equal(
      classifyOrchestratorOutcome(threads[1], {
        status,
        execution_session_id: 11,
      }),
      "failed",
      `closed thread with ${status} execution must remain failed`,
    );
  }
  assert.equal(
    classifyOrchestratorOutcome(threads[1], { status: "live" }),
    "incomplete",
  );
  assert.equal(
    classifyOrchestratorOutcome({ status: "active" }, { status: "live" }),
    "incomplete",
  );
  assert.equal(classifyOrchestratorOutcome(null, null), "incomplete");
});

test("orchestrator settlement recognizes the latest terminal agent execution", () => {
  const executions = [
    {
      issue_identifier: "SYM-5",
      agent_kind: "cursor",
      status: "live",
      started_at: "2026-07-24T14:59:24Z",
    },
    {
      issue_identifier: "SYM-5",
      agent_kind: "cursor",
      status: "aborted",
      started_at: "2026-07-24T15:01:24Z",
    },
    {
      issue_identifier: "SYM-6",
      agent_kind: "claude",
      status: "saved",
      started_at: "2026-07-24T15:02:24Z",
    },
  ];

  assert.equal(
    selectIssueAgentExecution(executions, "SYM-5").status,
    "aborted",
  );
  assert.equal(isTerminalAgentExecution({ status: "live" }), false);
  assert.equal(isTerminalAgentExecution({ status: "aborted" }), true);
  assert.equal(isTerminalAgentExecution({ status: "saved" }), true);
  assert.equal(isTerminalAgentExecution(null), false);
  assert.equal(isTerminalExecutionThread({ status: "closed" }), true);
  assert.equal(isTerminalExecutionThread({ status: "error" }), true);
  assert.equal(isTerminalExecutionThread({ status: "active" }), false);
});

test("orchestrator settlement rejects contradictory or mismatched terminal signals", () => {
  assert.equal(
    isSettledOrchestratorExecution(
      { id: 8, status: "active" },
      { status: "aborted", execution_session_id: 8 },
    ),
    false,
  );
  assert.equal(
    isSettledOrchestratorExecution(
      { id: 8, status: "closed" },
      { status: "saved", execution_session_id: 8 },
    ),
    true,
  );
  assert.equal(
    isSettledOrchestratorExecution(
      { id: 8, status: "closed" },
      { status: "saved", execution_session_id: 9 },
    ),
    false,
  );
});
