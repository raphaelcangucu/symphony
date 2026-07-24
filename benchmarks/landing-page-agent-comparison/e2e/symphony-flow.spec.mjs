import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createApi } from "../src/api.mjs";
import { readCanonicalPrompt } from "../src/contract.mjs";
import {
  classifySessionOutcome,
  issueRoute,
  issueStatusName,
  selectRun,
  sessionRoute,
} from "../src/run-cell.mjs";

const runtimeRoot = resolve(process.env.SYMPHONY_BENCH_RUNTIME ?? "");
const runId = process.env.SYMPHONY_BENCH_RUN_ID ?? "";
const baseUrl = process.env.SYMPHONY_BENCH_URL ?? "";
const token = process.env.SYMPHONY_BENCH_TOKEN ?? "";
const artifactRoot = resolve(process.env.SYMPHONY_BENCH_ARTIFACT_ROOT ?? "");
const resultPath = join(runtimeRoot, "results", `${runId}.json`);

async function loadRun() {
  const manifest = JSON.parse(await readFile(join(runtimeRoot, "runs.json"), "utf8"));
  return { manifest, run: selectRun(manifest, runId) };
}

async function waitForIssueCompletion(api, projectSlug, identifier, timeoutMs) {
  const startedAt = Date.now();
  let issue;
  while (Date.now() - startedAt < timeoutMs) {
    issue = await api.request(
      `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}`,
    );
    const status = issueStatusName(issue);
    if (status === "Human Review" || status === "Done") return issue;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(
    `orchestrator issue ${identifier} did not complete; last status=${issueStatusName(issue) ?? "unknown"}`,
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
  const api = createApi({ baseUrl, token });
  const result = {
    id: run.id,
    path: run.path,
    provider: run.provider,
    prompt_sha256: run.prompt_sha256,
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
      if (!((await executionMode.textContent()) ?? "").toLowerCase().includes(run.execution_mode)) {
        await executionMode.click();
        await page
          .getByRole("menuitemradio", { name: new RegExp(run.execution_mode, "i") })
          .click();
      }
      const assistantMessages = page.locator('[data-testid="assistant-chat-message"]');
      const initialMessageCount = await assistantMessages.count();

      await composer.fill(prompt);
      await page.getByRole("button", { name: "Send message" }).click();
      await page
        .getByRole("status")
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => {});
      await expect(page.getByRole("status")).toHaveCount(0, {
        timeout: 25 * 60 * 1000,
      });
      result.agent_outcome = classifySessionOutcome(
        initialMessageCount,
        await assistantMessages.count(),
      );
      if (result.agent_outcome === "failed") {
        result.error = "session ended without an assistant response";
      }
    } else {
      const route = issueRoute(manifest.project_slug, run.issue_identifier);
      result.tracker_url = new URL(route, baseUrl).href;
      const issuePath = `/projects/${encodeURIComponent(manifest.project_slug)}/issues/${encodeURIComponent(run.issue_identifier)}`;
      const issueBefore = await api.request(issuePath);
      if (!["Human Review", "Done"].includes(issueStatusName(issueBefore))) {
        await api.request(`${issuePath}/dispatch`, {
          method: "POST",
          body: {
              action: "hard_reset",
              agent: run.provider,
              mode: run.execution_mode,
            },
          },
        );
      }
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await waitForIssueCompletion(
        api,
        manifest.project_slug,
        run.issue_identifier,
        25 * 60 * 1000,
      );
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    result.preview = await startPreview(api, run, manifest.project_slug);
    await page.screenshot({
      path: join(artifactRoot, "symphony-final.png"),
      fullPage: true,
    });
    result.status =
      result.agent_outcome === "failed" ? "blocked" : "completed";
  } catch (error) {
    result.status = "blocked";
    result.error = error?.stack ?? String(error);
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
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    await testInfo.attach("benchmark-result", {
      body: Buffer.from(JSON.stringify(result, null, 2)),
      contentType: "application/json",
    });
  }
});
