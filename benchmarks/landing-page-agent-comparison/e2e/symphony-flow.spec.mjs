import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createApi } from "../src/api.mjs";
import {
  promptSha256,
  readCanonicalPrompt,
  workflowPromptTemplate,
} from "../src/contract.mjs";
import {
  benchmarkResultStatus,
  classifySessionOutcome,
  sessionFailureSummary,
  classifyOrchestratorOutcome,
  modelProvenanceMatches,
  issueRoute,
  issueStatusName,
  isSettledOrchestratorExecution,
  selectRun,
  selectIssueAgentExecution,
  selectIssueExecutionThread,
  sessionRoute,
  sessionProviderError,
  shouldDispatchIssue,
} from "../src/run-cell.mjs";

const runtimeRoot = resolve(process.env.SYMPHONY_BENCH_RUNTIME ?? "");
const runId = process.env.SYMPHONY_BENCH_RUN_ID ?? "";
const attemptId = process.env.SYMPHONY_BENCH_ATTEMPT_ID ?? "";
const baseUrl = process.env.SYMPHONY_BENCH_URL ?? "";
const token = process.env.SYMPHONY_BENCH_TOKEN ?? "";
const artifactRoot = resolve(process.env.SYMPHONY_BENCH_ARTIFACT_ROOT ?? "");
const resultPath = join(runtimeRoot, "results", `${runId}.json`);

async function loadRun() {
  const manifest = JSON.parse(
    await readFile(join(runtimeRoot, "runs.json"), "utf8"),
  );
  return { manifest, run: selectRun(manifest, runId) };
}

async function waitForIssueCompletion(api, projectSlug, identifier, timeoutMs) {
  const startedAt = Date.now();
  let issue;
  let execution;
  let executionThread;
  while (Date.now() - startedAt < timeoutMs) {
    issue = await api.request(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}`,
    );
    const executions = await api.request("/agent_executions");
    execution = selectIssueAgentExecution(executions, identifier);
    const threads = await api.request(
      `/assistant/threads?project_slug=${encodeURIComponent(projectSlug)}`,
    );
    executionThread = selectIssueExecutionThread(threads, identifier);
    if (isSettledOrchestratorExecution(executionThread, execution)) {
      return { issue, execution, executionThread };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(
    `orchestrator issue ${identifier} did not settle; ` +
      `last issue status=${issueStatusName(issue) ?? "unknown"}, ` +
      `execution status=${execution?.status ?? "missing"}, ` +
      `thread status=${executionThread?.status ?? "missing"}`,
  );
}

async function startPreview(api, run, projectSlug) {
  const path =
    run.path === "session"
      ? `/assistant/threads/${run.thread_id}/dev_servers/start`
      : `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(run.issue_identifier)}/dev_servers/start`;
  return api.request(path, { method: "POST", body: {} });
}

test("executes one provider cell through the real Symphony tracker", async ({
  page,
}, testInfo) => {
  const startedAt = new Date();
  const { manifest, run } = await loadRun();
  const prompt = await readCanonicalPrompt();
  const actualPromptHash = promptSha256(prompt);
  if (run.prompt_sha256 !== actualPromptHash) {
    throw new Error(
      `manifest prompt hash mismatch for ${run.id}: ` +
        `${run.prompt_sha256} != ${actualPromptHash}`,
    );
  }
  const api = createApi({ baseUrl, token });
  const result = {
    id: run.id,
    attempt_id: attemptId,
    path: run.path,
    provider: run.provider,
    prompt_sha256: actualPromptHash,
    effective_prompt_sha256: actualPromptHash,
    started_at: startedAt.toISOString(),
    status: "running",
    tracker_url: null,
    preview: null,
    agent_outcome: null,
    error: null,
    artifact_root: artifactRoot,
  };

  await mkdir(artifactRoot, { recursive: true });
  await page.addInitScript(
    ({ trackerToken }) => {
      window.localStorage.setItem("symphony.tracker.token", trackerToken);
    },
    { trackerToken: token },
  );

  try {
    if (run.path === "session") {
      const route = sessionRoute(manifest.project_slug, run.thread_id);
      result.tracker_url = new URL(route, baseUrl).href;
      await page.goto(route, { waitUntil: "domcontentloaded" });

      const composer = page.getByPlaceholder("Write a message...");
      await expect(composer).toBeVisible({ timeout: 60_000 });
      const executionMode = page.getByTestId("execution-mode-menu");
      await expect(executionMode).toBeVisible();
      if (
        !((await executionMode.textContent()) ?? "")
          .toLowerCase()
          .includes(run.execution_mode)
      ) {
        await executionMode.click();
        await page
          .getByRole("menuitemradio", {
            name: new RegExp(run.execution_mode, "i"),
          })
          .click();
      }
      const assistantMessages = page.locator(
        '[data-testid="assistant-chat-message"]',
      );
      const initialMessageCount = await assistantMessages.count();
      const initialThread = await api
        .request(`/assistant/threads/${run.thread_id}`)
        .catch(() => null);
      const validationRun = {
        ...run,
        initial_thread_updated_at: initialThread?.updated_at ?? null,
      };

      await composer.fill(prompt);
      await page.getByRole("button", { name: "Send message" }).click();
      await page
        .getByRole("status")
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => {});
      await expect(page.getByRole("status")).toHaveCount(0, {
        timeout: 25 * 60 * 1000,
      });
      const thread = await api
        .request(`/assistant/threads/${run.thread_id}`)
        .catch(() => null);
      result.agent_outcome = classifySessionOutcome(
        initialMessageCount,
        await assistantMessages.count(),
        thread,
        validationRun,
      );
      result.identity = {
        assistant_thread_id: thread?.id ?? run.thread_id,
        agent_kind: thread?.agent_kind ?? null,
        status: thread?.status ?? null,
        provider_matches: thread?.agent_kind === run.provider,
        requested_model: thread?.requested_model ?? null,
        requested_effort: thread?.requested_effort ?? null,
        resolved_model: thread?.resolved_model ?? null,
        resolved_effort: thread?.resolved_effort ?? null,
      };
      if (result.agent_outcome === "failed") {
        result.provider_error = sessionProviderError(thread);
        result.error = sessionFailureSummary(
          initialMessageCount,
          await assistantMessages.count(),
          thread,
          validationRun,
        );
      }
    } else {
      const route = issueRoute(manifest.project_slug, run.issue_identifier);
      result.tracker_url = new URL(route, baseUrl).href;
      const issuePath = `/projects/${encodeURIComponent(manifest.project_slug)}/issues/${encodeURIComponent(run.issue_identifier)}`;
      const issueBefore = await api.request(issuePath);
      const project = await api.request(
        `/projects/${encodeURIComponent(manifest.project_slug)}`,
      );
      const promptTemplate = workflowPromptTemplate(
        project?.setup?.workflow_markdown,
      );
      if (promptTemplate !== "{{ issue.description }}") {
        throw new Error("orchestrator workflow prompt body is not canonical");
      }
      if (issueBefore?.description !== prompt) {
        throw new Error(
          `orchestrator issue ${run.issue_identifier} description differs from canonical prompt`,
        );
      }
      result.effective_prompt_sha256 = promptSha256(issueBefore.description);
      const executionsBefore = await api.request("/agent_executions");
      const previousExecution = selectIssueAgentExecution(
        executionsBefore,
        run.issue_identifier,
      );
      if (shouldDispatchIssue(issueBefore, previousExecution)) {
        await api.request(`${issuePath}/dispatch`, {
          method: "POST",
          body: {
            action: "hard_reset",
            agent: run.provider,
            mode: run.execution_mode,
            model: run.requested_model,
            effort: run.requested_effort,
          },
        });
      }
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const settlement = await waitForIssueCompletion(
        api,
        manifest.project_slug,
        run.issue_identifier,
        40 * 60 * 1000,
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      const executionThread = settlement.executionThread;
      result.agent_outcome = classifyOrchestratorOutcome(
        executionThread,
        settlement.execution,
      );
      result.identity = {
        assistant_thread_id: executionThread?.id ?? null,
        issue_identifier: run.issue_identifier,
        agent_kind: executionThread?.agent_kind ?? null,
        status: executionThread?.status ?? null,
        provider_matches: executionThread?.agent_kind === run.provider,
        requested_model: executionThread?.requested_model ?? null,
        requested_effort: executionThread?.requested_effort ?? null,
        resolved_model: executionThread?.resolved_model ?? null,
        resolved_effort: executionThread?.resolved_effort ?? null,
        agent_execution_status: settlement.execution?.status ?? null,
        agent_execution_runtime_seconds:
          settlement.execution?.runtime_seconds ?? null,
        agent_execution_started_at: settlement.execution?.started_at ?? null,
        agent_execution_last_event_at:
          settlement.execution?.last_event_at ?? null,
      };
      if (
        result.agent_outcome !== "completed" ||
        !result.identity.provider_matches ||
        !modelProvenanceMatches(executionThread, run)
      ) {
        result.error =
          `orchestrator execution ${result.identity.status ?? "missing"} ` +
          `for provider ${result.identity.agent_kind ?? "unknown"}`;
      }
    }

    result.preview = await startPreview(api, run, manifest.project_slug);
    await page.screenshot({
      path: join(artifactRoot, "symphony-final.png"),
      fullPage: true,
    });
    result.status = benchmarkResultStatus(result);
    if (result.status !== "completed") {
      throw new Error(result.error ?? "benchmark cell did not complete");
    }
  } catch (error) {
    result.status = "blocked";
    result.error ??= error?.stack ?? String(error);
    await page
      .screenshot({
        path: join(artifactRoot, "symphony-blocked.png"),
        fullPage: true,
      })
      .catch(() => {});
    throw error;
  } finally {
    result.finished_at = new Date().toISOString();
    result.duration_ms = Date.now() - startedAt.getTime();
    const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
    const attemptResultRoot = join(runtimeRoot, "results", "attempts", run.id);
    await mkdir(attemptResultRoot, { recursive: true });
    await writeFile(resultPath, serializedResult);
    await writeFile(
      join(attemptResultRoot, `${attemptId}.json`),
      serializedResult,
    );
    await testInfo.attach("benchmark-result", {
      body: Buffer.from(JSON.stringify(result, null, 2)),
      contentType: "application/json",
    });
  }
});
