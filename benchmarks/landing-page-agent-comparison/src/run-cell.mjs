import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { RUN_MATRIX } from "./contract.mjs";
import { executeProcess } from "./process.mjs";
import { PLAYWRIGHT_PROCESS_TIMEOUT_MS } from "./timeouts.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function selectRun(manifest, runId) {
  const matches = manifest?.runs?.filter((run) => run.id === runId) ?? [];
  if (matches.length !== 1) {
    throw new Error(`unknown benchmark run: ${runId}`);
  }
  return matches[0];
}

export function artifactSlug(runId) {
  const pathSafe = /^[a-z0-9][a-z0-9.-]{0,127}$/.test(runId);
  const canonical = RUN_MATRIX.some((run) => run.id === runId);
  if (!pathSafe || !canonical) {
    throw new Error(`invalid benchmark run id: ${runId}`);
  }
  return runId;
}

export function attemptSlug(attemptId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(attemptId)) {
    throw new Error(`invalid benchmark attempt id: ${attemptId}`);
  }
  return attemptId;
}

export function attemptArtifactPath(runtimeRoot, runId, attemptId) {
  return join(
    resolve(runtimeRoot),
    "artifacts",
    artifactSlug(runId),
    "attempts",
    attemptSlug(attemptId),
  );
}

export function sessionRoute(projectSlug, threadId) {
  return `/tracker/projects/${encodeURIComponent(projectSlug)}/workspaces/${encodeURIComponent(threadId)}`;
}

export function issueRoute(projectSlug, identifier) {
  return `/tracker/projects/${encodeURIComponent(projectSlug)}/board/issues/${encodeURIComponent(identifier)}/sessions?surface=autonomous`;
}

export function classifySessionOutcome(initialMessageCount, finalMessageCount, thread, run) {
  if (!sessionTurnObserved(initialMessageCount, finalMessageCount, thread, run)) return "failed";
  if (!thread || thread.agent_kind !== run?.provider) return "failed";
  if (thread.status === "error" || sessionProviderError(thread)) return "failed";
  if (!modelProvenanceMatches(thread, run)) return "failed";
  return "completed";
}

export function benchmarkResultStatus(result) {
  return result?.agent_outcome === "completed" &&
    result?.identity?.provider_matches !== false &&
    !result?.error
    ? "completed"
    : "blocked";
}

export function sessionFailureSummary(initialMessageCount, finalMessageCount, thread, run) {
  const providerError = sessionProviderError(thread);
  if (providerError) return providerError.summary;
  if (!sessionTurnObserved(initialMessageCount, finalMessageCount, thread, run))
    return "session ended without an assistant response";
  if (!thread) return "assistant thread could not be read after completion";
  if (thread.agent_kind !== run?.provider) {
    return `provider mismatch: requested ${run?.provider ?? "unknown"}, resolved ${thread.agent_kind ?? "unknown"}`;
  }
  if (!modelProvenanceMatches(thread, run)) {
    return `model provenance mismatch: requested ${formatModelEffort(run?.requested_model, run?.requested_effort)}, resolved ${formatModelEffort(thread.resolved_model, thread.resolved_effort)}`;
  }
  return `session ended with status ${thread.status ?? "unknown"}`;
}

export function sessionTurnObserved(initialMessageCount, finalMessageCount, thread, run) {
  if (finalMessageCount > initialMessageCount) return true;
  const initialUpdatedAt = run?.initial_thread_updated_at;
  return (
    typeof initialUpdatedAt === "string" &&
    initialUpdatedAt !== "" &&
    typeof thread?.updated_at === "string" &&
    thread.updated_at !== initialUpdatedAt
  );
}

function formatModelEffort(model, effort) {
  return `${model ?? "unknown"}/${effort ?? "none"}`;
}

export function modelProvenanceMatches(thread, run) {
  if (!thread || !run?.requested_model) return false;
  const expectedEffort = run.requested_effort ?? null;

  if (run.provider === "cursor") {
    return (
      thread.requested_model === run.requested_model &&
      (thread.requested_effort ?? null) === null &&
      resolvedModelMatches(run.provider, thread.resolved_model, run.requested_model) &&
      (thread.resolved_effort ?? null) === expectedEffort
    );
  }

  return (
    thread.requested_model === run.requested_model &&
    (thread.requested_effort ?? null) === expectedEffort &&
    resolvedModelMatches(run.provider, thread.resolved_model, run.requested_model) &&
    (thread.resolved_effort ?? null) === expectedEffort
  );
}

export function resolvedModelMatches(provider, resolvedModel, requestedModel) {
  if (provider === "cursor" && requestedModel === "auto") {
    return typeof resolvedModel === "string" && resolvedModel !== "" && resolvedModel !== "auto";
  }
  return Boolean(provider) && resolvedModel === requestedModel;
}

export function issueStatusName(issue) {
  return typeof issue?.status === "string" ? issue.status : (issue?.status?.name ?? null);
}

export function shouldDispatchIssue(issue, execution = null) {
  const status = issueStatusName(issue);
  if (status === "Backlog") return true;
  return status === "Human Review" && ["aborted", "failed", "error"].includes(execution?.status);
}

export function sessionProviderError(thread) {
  const turn = thread?.metadata?.current_turn;
  if (!turn?.error && !turn?.error_detail) return null;
  const raw = typeof turn.error === "string" ? turn.error : null;
  const summary =
    raw?.includes("invalid_union") && raw.includes("mcpServers")
      ? "Cursor ACP rejected mcpServers payload (invalid_union)"
      : (turn.error_detail?.message ?? raw ?? "Agent operation failed");
  return {
    code: turn.error_code ?? turn.error_detail?.code ?? null,
    category: turn.error_detail?.category ?? null,
    retryable: turn.error_detail?.retryable ?? null,
    summary,
    raw,
  };
}

export function selectIssueExecutionThread(threads, issueIdentifier) {
  return (
    (Array.isArray(threads) ? threads : [])
      .filter(
        (thread) =>
          thread?.scope === "issue_execution" && thread.issue_identifier === issueIdentifier,
      )
      .sort((left, right) => Number(right.id) - Number(left.id))[0] ?? null
  );
}

export function selectIssueAgentExecution(executions, issueIdentifier) {
  return (
    (Array.isArray(executions) ? executions : [])
      .filter((execution) => execution?.issue_identifier === issueIdentifier)
      .sort((left, right) =>
        String(right.started_at ?? "").localeCompare(String(left.started_at ?? "")),
      )[0] ?? null
  );
}

export function isTerminalAgentExecution(execution) {
  return new Set(["aborted", "cancelled", "canceled", "completed", "error", "failed", "saved"]).has(
    execution?.status,
  );
}

export function isTerminalExecutionThread(thread) {
  return thread?.status === "closed" || thread?.status === "error";
}

export function isSettledOrchestratorExecution(thread, execution) {
  if (!isTerminalExecutionThread(thread) || !isTerminalAgentExecution(execution)) {
    return false;
  }
  const executionThreadId = Number(execution?.execution_session_id);
  return Number.isInteger(executionThreadId) && executionThreadId === Number(thread?.id);
}

export function classifyOrchestratorOutcome(thread, execution = null) {
  if (thread?.status === "closed" && isSettledOrchestratorExecution(thread, execution)) {
    return new Set(["completed", "saved"]).has(execution?.status) ? "completed" : "failed";
  }
  if (thread?.status === "error") return "failed";
  return "incomplete";
}

function requiredEnvironment(env) {
  const runtimeRoot = env.SYMPHONY_BENCH_RUNTIME?.trim();
  const runId = env.SYMPHONY_BENCH_RUN_ID?.trim();
  if (!runtimeRoot || !runId) {
    throw new Error("SYMPHONY_BENCH_RUNTIME and SYMPHONY_BENCH_RUN_ID are required");
  }
  return { runtimeRoot: resolve(runtimeRoot), runId: artifactSlug(runId) };
}

function executePlaywright(env) {
  return executeProcess(
    "npx",
    ["playwright", "test", "e2e/symphony-flow.spec.mjs", "--workers=1"],
    {
      cwd: packageRoot,
      env,
      timeout: PLAYWRIGHT_PROCESS_TIMEOUT_MS,
      maxOutput: 16 * 1024 * 1024,
      onStdout: (text) => process.stdout.write(text),
      onStderr: (text) => process.stderr.write(text),
    },
  );
}

export async function runCell(env = process.env) {
  const { runtimeRoot, runId } = requiredEnvironment(env);
  const manifest = JSON.parse(await readFile(join(runtimeRoot, "runs.json"), "utf8"));
  selectRun(manifest, runId);

  const attemptId = attemptSlug(
    `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID()}`,
  );
  const artifactRoot = attemptArtifactPath(runtimeRoot, runId, attemptId);
  const resultPath = join(runtimeRoot, "results", `${runId}.json`);
  await mkdir(artifactRoot, { recursive: true });

  const execution = await executePlaywright({
    ...env,
    SYMPHONY_BENCH_RUN_ID: runId,
    SYMPHONY_BENCH_ATTEMPT_ID: attemptId,
    SYMPHONY_BENCH_ARTIFACT_ROOT: artifactRoot,
  });

  let recordedResult = null;
  try {
    recordedResult = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (recordedResult?.attempt_id !== attemptId) {
    const fallbackResult = `${JSON.stringify(
      {
        id: runId,
        attempt_id: attemptId,
        status: "blocked",
        finished_at: new Date().toISOString(),
        error:
          execution.status === "timed_out"
            ? `Playwright timed out after ${PLAYWRIGHT_PROCESS_TIMEOUT_MS} ms`
            : `Playwright exited with code ${execution.exit_code} before writing a result`,
        artifact_root: artifactRoot,
      },
      null,
      2,
    )}\n`;
    await writeFile(resultPath, fallbackResult);
    const attemptResultRoot = join(runtimeRoot, "results", "attempts", runId);
    await mkdir(attemptResultRoot, { recursive: true });
    await writeFile(join(attemptResultRoot, `${attemptId}.json`), fallbackResult);
  }

  return execution.exit_code ?? (execution.status === "timed_out" ? 124 : 1);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (invokedPath === import.meta.url) {
  runCell().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
