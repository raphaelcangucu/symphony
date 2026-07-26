import {
  isSettledOrchestratorExecution,
  issueStatusName,
  selectIssueAgentExecution,
  selectIssueExecutionThread,
} from "./run-cell.mjs";
import { ORCHESTRATOR_CLEANUP_TIMEOUT_MS, ORCHESTRATOR_POLL_INTERVAL_MS } from "./timeouts.mjs";

export class OrchestratorSettlementTimeout extends Error {
  constructor(identifier, snapshot, timeoutMs) {
    super(
      `orchestrator issue ${identifier} did not settle after ${timeoutMs}ms; ` +
        `last issue status=${issueStatusName(snapshot.issue) ?? "unknown"}, ` +
        `execution status=${snapshot.execution?.status ?? "missing"}, ` +
        `thread status=${snapshot.executionThread?.status ?? "missing"}`,
    );
    this.name = "OrchestratorSettlementTimeout";
    this.snapshot = snapshot;
    this.timeoutMs = timeoutMs;
  }
}

function issuePath(projectSlug, identifier) {
  return `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}`;
}

async function readSnapshot(api, projectSlug, identifier) {
  const issue = await api.request(issuePath(projectSlug, identifier));
  const executions = await api.request("/agent_executions");
  const execution = selectIssueAgentExecution(executions, identifier);
  const threads = await api.request(
    `/assistant/threads?project_slug=${encodeURIComponent(projectSlug)}`,
  );
  const executionThread = selectIssueExecutionThread(threads, identifier);

  return { issue, execution, executionThread };
}

export async function waitForIssueCompletion(
  api,
  projectSlug,
  identifier,
  {
    timeoutMs,
    pollIntervalMs = ORCHESTRATOR_POLL_INTERVAL_MS,
    now = Date.now,
    sleep = (durationMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs)),
  },
) {
  const startedAt = now();

  while (true) {
    const snapshot = await readSnapshot(api, projectSlug, identifier);
    if (isSettledOrchestratorExecution(snapshot.executionThread, snapshot.execution)) {
      return snapshot;
    }
    if (now() - startedAt >= timeoutMs) {
      throw new OrchestratorSettlementTimeout(identifier, snapshot, timeoutMs);
    }
    await sleep(pollIntervalMs);
  }
}

export async function stopUnsettledOrchestrator(
  api,
  projectSlug,
  identifier,
  {
    timeoutMs = ORCHESTRATOR_CLEANUP_TIMEOUT_MS,
    pollIntervalMs = ORCHESTRATOR_POLL_INTERVAL_MS,
    now = Date.now,
    sleep = (durationMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs)),
  } = {},
) {
  const before = await readSnapshot(api, projectSlug, identifier);
  if (isSettledOrchestratorExecution(before.executionThread, before.execution)) {
    return { ...before, stopped: false };
  }

  await api.request(`${issuePath(projectSlug, identifier)}/dispatch`, {
    method: "POST",
    body: { action: "stop" },
  });

  const settled = await waitForIssueCompletion(api, projectSlug, identifier, {
    timeoutMs,
    pollIntervalMs,
    now,
    sleep,
  });
  return { ...settled, stopped: true };
}
