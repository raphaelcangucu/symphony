import assert from "node:assert/strict";
import test from "node:test";

import {
  OrchestratorSettlementTimeout,
  stopUnsettledOrchestrator,
  waitForIssueCompletion,
} from "../src/orchestrator-settlement.mjs";

function sequencedApi({ issues, executions, threads }) {
  const calls = [];
  let read = 0;

  return {
    calls,
    async request(path, options) {
      calls.push([path, options]);

      if (path.endsWith("/dispatch")) return { stopped: true };
      if (path === "/agent_executions") return executions[Math.min(read, executions.length - 1)];
      if (path.startsWith("/assistant/threads?")) {
        const value = threads[Math.min(read, threads.length - 1)];
        read += 1;
        return value;
      }
      return issues[Math.min(read, issues.length - 1)];
    },
  };
}

test("waitForIssueCompletion follows the canonical execution session to settlement", async () => {
  const api = sequencedApi({
    issues: [{ status: "In Progress" }, { status: "Human Review" }],
    executions: [
      [
        {
          issue_identifier: "DEV-24",
          status: "live",
          execution_session_id: 15,
          started_at: "2026-07-26T15:52:57Z",
        },
      ],
      [
        {
          issue_identifier: "DEV-24",
          status: "saved",
          execution_session_id: 15,
          started_at: "2026-07-26T15:52:57Z",
        },
      ],
    ],
    threads: [
      [
        {
          id: 15,
          issue_identifier: "DEV-24",
          scope: "issue_execution",
          status: "active",
        },
      ],
      [
        {
          id: 15,
          issue_identifier: "DEV-24",
          scope: "issue_execution",
          status: "closed",
        },
      ],
    ],
  });
  let now = 0;

  const settlement = await waitForIssueCompletion(api, "dev10x-landing-benchmark", "DEV-24", {
    timeoutMs: 1_000,
    now: () => now,
    sleep: async () => {
      now += 10;
    },
  });

  assert.equal(settlement.execution.status, "saved");
  assert.equal(settlement.executionThread.id, 15);
});

test("timeout preserves the last authoritative snapshot for cleanup and diagnostics", async () => {
  const api = sequencedApi({
    issues: [{ status: "In Progress" }],
    executions: [
      [
        {
          issue_identifier: "DEV-24",
          status: "idle",
          execution_session_id: 15,
          started_at: "2026-07-26T15:52:57Z",
        },
      ],
    ],
    threads: [
      [
        {
          id: 15,
          issue_identifier: "DEV-24",
          scope: "issue_execution",
          status: "active",
        },
      ],
    ],
  });
  let now = 0;

  await assert.rejects(
    waitForIssueCompletion(api, "dev10x-landing-benchmark", "DEV-24", {
      timeoutMs: 10,
      now: () => now,
      sleep: async () => {
        now += 10;
      },
    }),
    (error) => {
      assert.ok(error instanceof OrchestratorSettlementTimeout);
      assert.equal(error.snapshot.execution.status, "idle");
      assert.equal(error.snapshot.executionThread.status, "active");
      return true;
    },
  );
});

test("failed benchmark ownership stops the live execution and waits for terminal state", async () => {
  const api = sequencedApi({
    issues: [{ status: "In Progress" }, { status: "In Progress" }],
    executions: [
      [
        {
          issue_identifier: "DEV-24",
          status: "idle",
          execution_session_id: 15,
          started_at: "2026-07-26T15:52:57Z",
        },
      ],
      [
        {
          issue_identifier: "DEV-24",
          status: "aborted",
          execution_session_id: 15,
          started_at: "2026-07-26T15:52:57Z",
        },
      ],
    ],
    threads: [
      [
        {
          id: 15,
          issue_identifier: "DEV-24",
          scope: "issue_execution",
          status: "active",
        },
      ],
      [
        {
          id: 15,
          issue_identifier: "DEV-24",
          scope: "issue_execution",
          status: "error",
        },
      ],
    ],
  });
  let now = 0;

  const cleanup = await stopUnsettledOrchestrator(api, "dev10x-landing-benchmark", "DEV-24", {
    timeoutMs: 1_000,
    now: () => now,
    sleep: async () => {
      now += 10;
    },
  });

  assert.equal(cleanup.stopped, true);
  assert.equal(cleanup.execution.status, "aborted");
  assert.deepEqual(
    api.calls.find(([path]) => path.endsWith("/dispatch")),
    [
      "/projects/dev10x-landing-benchmark/issues/DEV-24/dispatch",
      { method: "POST", body: { action: "stop" } },
    ],
  );
});
