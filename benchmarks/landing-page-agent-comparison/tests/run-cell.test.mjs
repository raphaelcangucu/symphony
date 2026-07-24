import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactSlug,
  attemptArtifactPath,
  attemptSlug,
  classifySessionOutcome,
  issueRoute,
  issueStatusName,
  classifyOrchestratorOutcome,
  isTerminalAgentExecution,
  isTerminalExecutionThread,
  selectRun,
  selectIssueAgentExecution,
  selectIssueExecutionThread,
  sessionRoute,
  sessionProviderError,
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
  assert.equal(artifactSlug("orchestrator-claude"), "orchestrator-claude");
  assert.throws(() => artifactSlug("../../escape"), /invalid benchmark run id/);
});

test("attempt artifacts are immutable and path-safe", () => {
  assert.equal(attemptSlug("20260724T120000000Z-a1b2c3"), "20260724T120000000Z-a1b2c3");
  assert.throws(() => attemptSlug("../latest"), /invalid benchmark attempt id/);
  assert.equal(
    attemptArtifactPath("/tmp/runtime", "orchestrator-claude", "attempt-01"),
    "/tmp/runtime/artifacts/orchestrator-claude/attempts/attempt-01",
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

test("session outcome requires a real provider response without a thread error", () => {
  const healthyThread = {
    agent_kind: "codex",
    status: "active",
    metadata: {},
  };
  assert.equal(classifySessionOutcome(0, 1, healthyThread, "codex"), "completed");
  assert.equal(classifySessionOutcome(0, 0, healthyThread, "codex"), "failed");
  assert.equal(
    classifySessionOutcome(
      0,
      1,
      {
        ...healthyThread,
        status: "error",
      },
      "codex",
    ),
    "failed",
  );
  assert.equal(
    classifySessionOutcome(0, 1, healthyThread, "claude"),
    "failed",
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
  assert.equal(shouldDispatchIssue({ status: { name: "Human Review" } }), false);
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
    classifyOrchestratorOutcome(threads[0], { status: "aborted" }),
    "failed",
  );
  assert.equal(
    classifyOrchestratorOutcome(threads[1], { status: "saved" }),
    "completed",
  );
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

  assert.equal(selectIssueAgentExecution(executions, "SYM-5").status, "aborted");
  assert.equal(isTerminalAgentExecution({ status: "live" }), false);
  assert.equal(isTerminalAgentExecution({ status: "aborted" }), true);
  assert.equal(isTerminalAgentExecution({ status: "saved" }), true);
  assert.equal(isTerminalAgentExecution(null), false);
  assert.equal(isTerminalExecutionThread({ status: "closed" }), true);
  assert.equal(isTerminalExecutionThread({ status: "error" }), true);
  assert.equal(isTerminalExecutionThread({ status: "active" }), false);
});
