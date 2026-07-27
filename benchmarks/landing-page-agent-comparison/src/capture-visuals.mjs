import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";
import { createApi } from "./api.mjs";
import { executeProcess } from "./process.mjs";
import { artifactSlug, modelProvenanceMatches } from "./run-cell.mjs";
import { sanitizedChildEnv } from "../seed/scripts/child-env.mjs";

export function visualPort(index) {
  if (!Number.isInteger(index) || index < 0 || index > 99) {
    throw new Error(`invalid visual capture index: ${index}`);
  }
  return 23_000 + index;
}

export function previewArgs(port) {
  return [
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ];
}

export function visualScreenshotNames(runId) {
  const safeRunId = artifactSlug(runId);
  return {
    hero: `${safeRunId}-hero.png`,
    flow: `${safeRunId}-flow.png`,
    siteEvidence: `${safeRunId}-site-evidence.png`,
    full: `${safeRunId}-full.png`,
    mobileFull: `${safeRunId}-mobile-full.png`,
    evidenceTab: `${safeRunId}-evidence-tab.png`,
    video: `${safeRunId}-e2e.webm`,
    mp4: `${safeRunId}-e2e.mp4`,
    previewGif: `${safeRunId}-e2e-preview.gif`,
  };
}

export function renderVisualComparison(captures) {
  const lines = [
    "# Comparação visual padronizada",
    "",
    "Viewports: desktop 1280 × 720 e mobile 390 × 844; páginas completas, movimento reduzido e servidor isolado por célula.",
    "",
  ];
  for (const capture of captures) {
    lines.push(`## ${capture.id}`, "");
    if (capture.status === "captured") {
      lines.push(
        `![Hero de ${capture.id}](screens/${capture.id}-hero.png)`,
        "",
        `![Fluxo de ${capture.id}](screens/${capture.id}-flow.png)`,
        "",
        `![Seção de evidências de ${capture.id}](screens/${capture.id}-site-evidence.png)`,
        "",
        `![Página completa de ${capture.id}](screens/${capture.id}-full.png)`,
        "",
        `![Página mobile completa de ${capture.id}](screens/${capture.id}-mobile-full.png)`,
        "",
        `![Run renderizado na aba Evidências de ${capture.id}](screens/${capture.id}-evidence-tab.png)`,
        "",
        `[![Prévia animada de ${capture.id}](videos/${capture.id}-e2e-preview.gif)](videos/${capture.id}-e2e.mp4)`,
        "",
        `[Vídeo E2E MP4 de ${capture.id}](videos/${capture.id}-e2e.mp4)`,
      );
    } else {
      lines.push(
        `Captura indisponível: ${capture.status}${capture.error ? ` — ${capture.error}` : ""}.`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function terminateProcessGroup(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolvePromise) => {
    const onExit = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

export async function stopProcessGroup(child) {
  terminateProcessGroup(child);
  if (await waitForProcessExit(child, 750)) return;
  terminateProcessGroup(child, "SIGKILL");
  await waitForProcessExit(child, 250);
}

function forwardParentSignals(child) {
  let forwarding = false;
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (forwarding) return;
      forwarding = true;
      terminateProcessGroup(child);
      setTimeout(() => {
        terminateProcessGroup(child, "SIGKILL");
        for (const [registeredSignal, registeredHandler] of handlers) {
          process.removeListener(registeredSignal, registeredHandler);
        }
        process.kill(process.pid, signal);
      }, 250);
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    if (forwarding) return;
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
}

export async function waitForHttp(
  url,
  timeoutMs = 30_000,
  {
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = 1_000,
  } = {},
) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`preview did not become ready at ${url}: ${lastError}`);
}

export async function captureRunMatrix(runs, capture) {
  const captures = [];

  for (const [index, run] of runs.entries()) {
    try {
      captures.push(await capture(run, index));
    } catch (error) {
      captures.push({
        id: run.id,
        status: "capture-failed",
        error: error?.message ?? String(error),
      });
    }
  }

  return captures;
}

export function assertCaptureEligible(collected, run) {
  const validation = Array.isArray(collected?.validation)
    ? collected.validation
    : [];
  const failures = [];
  if (collected?.status !== "completed") failures.push("status is not completed");
  if (collected?.contract_passed !== true) failures.push("contract did not pass");
  if (collected?.agent_outcome !== "completed")
    failures.push("agent outcome is not completed");
  if (collected?.error) failures.push(`error is present: ${collected.error}`);
  if (collected?.identity?.provider_matches !== true)
    failures.push("provider identity did not match");
  if (!modelProvenanceMatches(collected?.identity, run))
    failures.push("model provenance did not match");
  if (
    validation.length < 3 ||
    validation.some((step) => step?.status !== "passed")
  ) {
    failures.push("validation is incomplete or failed");
  }

  if (failures.length > 0) {
    throw new Error(
      `${run.id} is not eligible for evidence capture: ${failures.join("; ")}`,
    );
  }
}

function workspaceForRun(manifest, run) {
  return join(workspaceRootForRun(manifest, run), "site");
}

function workspaceRootForRun(manifest, run) {
  if (run.path === "session") return run.workspace_path;
  return join(
    manifest.runtime_root,
    "workspaces",
    manifest.project_slug,
    run.issue_identifier.replace(/[^a-zA-Z0-9._-]/g, "_"),
  );
}

function validationStep(collected, suffix) {
  return (
    collected.validation?.find((step) => step.command.endsWith(suffix)) ?? null
  );
}

function artifactRef(path, label, navigations) {
  return { path, label, navigations };
}

export function evidenceManifestForRun({
  run,
  collected,
  navigations,
  names,
}) {
  if (
    !Array.isArray(navigations) ||
    navigations.length === 0 ||
    navigations.some(
      (navigation) =>
        typeof navigation !== "string" ||
        !/^https?:\/\//i.test(navigation.trim()),
    )
  ) {
    throw new Error(`missing observed browser navigation for ${run.id}`);
  }
  const build = validationStep(collected, "npm run build");
  const generatedE2e = validationStep(collected, "npm run test:e2e");
  const buildReport = "artifacts/reports/build.txt";
  const e2eReport = "artifacts/reports/e2e.txt";
  const heroRelative = `artifacts/screens/${names.hero}`;
  const flowRelative = `artifacts/screens/${names.flow}`;
  const siteEvidenceRelative = `artifacts/screens/${names.siteEvidence}`;
  const desktopRelative = `artifacts/screens/${names.full}`;
  const mobileRelative = `artifacts/screens/${names.mobileFull}`;
  const webmRelative = `artifacts/videos/${names.video}`;
  const mp4Relative = `artifacts/videos/${names.mp4}`;
  const traceRelative = `artifacts/traces/${run.id}-e2e.zip`;
  const label = `${run.id} landing page walkthrough`;

  return {
    issue: run.issue_identifier,
    generated_at: new Date().toISOString(),
    ui_change: true,
    runs: [
      {
        kind: "unit",
        repo: "site",
        command: "npm run build",
        status: build?.status ?? "failed",
        report: buildReport,
        duration_ms: build?.duration_ms ?? null,
      },
      {
        kind: "e2e",
        repo: "site",
        command: "npm run test:e2e",
        status: generatedE2e?.status ?? "failed",
        report: e2eReport,
        screenshots: [
          artifactRef(heroRelative, `${label} hero`, navigations),
          artifactRef(flowRelative, `${label} flow`, navigations),
          artifactRef(
            siteEvidenceRelative,
            `${label} evidence section`,
            navigations,
          ),
          artifactRef(
            desktopRelative,
            `${label} desktop full page`,
            navigations,
          ),
          artifactRef(
            mobileRelative,
            `${label} mobile full page`,
            navigations,
          ),
        ],
        videos: [
          artifactRef(webmRelative, `${label} WebM source`, navigations),
          artifactRef(mp4Relative, `${label} MP4 H.264`, navigations),
        ],
        trace: traceRelative,
        navigations,
        proof: {
          title: label,
          desktop_viewport: "1280x720",
          mobile_viewport: "390x844",
          full_page: true,
        },
      },
    ],
  };
}

export function assertEvidenceTabRecord(records, { runId, threadId }) {
  const record = (Array.isArray(records) ? records : []).find(
    (entry) =>
      entry?.run_id === runId &&
      String(entry?.session_id ?? "") === String(threadId),
  );
  if (!record) {
    throw new Error(`Evidence tab did not return persisted run ${runId}`);
  }
  if (record.status !== "passed") {
    throw new Error(`Evidence run ${runId} is not passed`);
  }

  const e2e = record.manifest?.runs?.find((run) => run?.kind === "e2e");
  if (!e2e) {
    throw new Error(`Evidence run ${runId} is missing its E2E run`);
  }
  const screenshots = Array.isArray(e2e.screenshots) ? e2e.screenshots : [];
  const videos = Array.isArray(e2e.videos) ? e2e.videos : [];
  const videoPaths = videos.map((entry) =>
    typeof entry === "string" ? entry : entry?.path,
  );
  if (
    e2e.status !== "passed" ||
    screenshots.length < 5 ||
    !videoPaths.some((path) => /\.webm$/i.test(path ?? "")) ||
    !videoPaths.some((path) => /\.mp4$/i.test(path ?? "")) ||
    typeof e2e.trace !== "string" ||
    e2e.trace.trim() === ""
  ) {
    throw new Error(`Evidence run ${runId} has an incomplete visual contract`);
  }

  return record;
}

export async function verifyEvidenceTabUi(
  page,
  { baseUrl, projectSlug, issueIdentifier, runId },
) {
  const route = new URL(
    `/tracker/projects/${encodeURIComponent(projectSlug)}/board/issues/${encodeURIComponent(issueIdentifier)}/evidence`,
    baseUrl,
  ).href;
  await page.goto(route, { waitUntil: "domcontentloaded" });

  const testId = `evidence-${runId}`;
  const card = page.getByTestId(testId);
  await card.waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    ({ evidenceTestId }) => {
      const record = document.querySelector(
        `[data-testid="${evidenceTestId}"]`,
      );
      if (!record) return false;
      const images = [...record.querySelectorAll("img")];
      const videos = [...record.querySelectorAll("video")];
      return (
        images.length >= 5 &&
        images.every((image) => image.complete && image.naturalWidth > 0) &&
        videos.length >= 2 &&
        videos.every((video) => video.readyState >= 1)
      );
    },
    { evidenceTestId: testId },
    { timeout: 60_000 },
  );

  const screenshotCount = await card.locator("img").count();
  const videoCount = await card.locator("video").count();
  if (screenshotCount < 5 || videoCount < 2) {
    throw new Error(
      `Evidence UI run ${runId} rendered ${screenshotCount} screenshots and ${videoCount} videos`,
    );
  }

  return {
    route,
    screenshot_count: screenshotCount,
    video_count: videoCount,
  };
}

async function transcodeMp4(webmPath, mp4Path) {
  const result = await executeProcess(
    "ffmpeg",
    [
      "-y",
      "-i",
      webmPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      mp4Path,
    ],
    { cwd: resolve(webmPath, ".."), timeout: 2 * 60 * 1000 },
  );
  if (result.status !== "passed") {
    throw new Error(`ffmpeg MP4 conversion failed: ${result.output}`);
  }
}

async function transcodeGifPreview(mp4Path, gifPath) {
  const result = await executeProcess(
    "ffmpeg",
    [
      "-y",
      "-i",
      mp4Path,
      "-filter_complex",
      "[0:v]fps=6,scale=480:-1:flags=lanczos,split[frames][palette_source];[palette_source]palettegen=max_colors=96[palette];[frames][palette]paletteuse=dither=bayer:bayer_scale=5",
      "-an",
      gifPath,
    ],
    { cwd: resolve(mp4Path, ".."), timeout: 2 * 60 * 1000 },
  );
  if (result.status !== "passed") {
    throw new Error(`ffmpeg GIF preview conversion failed: ${result.output}`);
  }
}

async function writeEvidenceManifest({
  run,
  collected,
  evidenceRoot,
  navigations,
  names,
  paths,
}) {
  const reportsRoot = join(evidenceRoot, "artifacts", "reports");
  await mkdir(reportsRoot, { recursive: true });
  const build = validationStep(collected, "npm run build");
  const generatedE2e = validationStep(collected, "npm run test:e2e");
  const buildReport = "artifacts/reports/build.txt";
  const e2eReport = "artifacts/reports/e2e.txt";
  await writeFile(join(evidenceRoot, buildReport), build?.output ?? "not run\n");
  await writeFile(
    join(evidenceRoot, e2eReport),
    generatedE2e?.output ?? "not run\n",
  );

  const manifest = evidenceManifestForRun({
    run,
    collected,
    navigations,
    names,
  });
  await writeFile(
    join(evidenceRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { manifest, ...paths };
}

async function captureRun({
  manifest,
  run,
  index,
  reportRoot,
  reportVideoRoot,
  api,
  trackerBaseUrl,
  trackerToken,
}) {
  const workspacePath = workspaceForRun(manifest, run);
  const workspaceRoot = workspaceRootForRun(manifest, run);
  const collectedPath = join(
    manifest.runtime_root,
    "results",
    `${run.id}-collected.json`,
  );
  if (!(await exists(collectedPath))) return { id: run.id, status: "not-collected" };

  const collected = JSON.parse(await readFile(collectedPath, "utf8"));
  assertCaptureEligible(collected, run);

  const port = visualPort(index);
  const url = `http://127.0.0.1:${port}/`;
  const names = visualScreenshotNames(run.id);
  const evidenceRoot = join(workspaceRoot, ".symphony", "evidence");
  const screensRoot = join(evidenceRoot, "artifacts", "screens");
  const videosRoot = join(evidenceRoot, "artifacts", "videos");
  const tracesRoot = join(evidenceRoot, "artifacts", "traces");
  await mkdir(screensRoot, { recursive: true });
  await mkdir(videosRoot, { recursive: true });
  await mkdir(tracesRoot, { recursive: true });
  const heroPath = join(screensRoot, names.hero);
  const flowPath = join(screensRoot, names.flow);
  const siteEvidencePath = join(screensRoot, names.siteEvidence);
  const desktopPath = join(screensRoot, names.full);
  const mobilePath = join(screensRoot, names.mobileFull);
  const evidenceTabPath = join(reportRoot, names.evidenceTab);
  const webmPath = join(videosRoot, names.video);
  const mp4Path = join(videosRoot, names.mp4);
  const gifPreviewPath = join(videosRoot, names.previewGif);
  const tracePath = join(tracesRoot, `${run.id}-e2e.zip`);
  const child = spawn(
    "npm",
    previewArgs(port),
    {
      cwd: workspacePath,
      detached: true,
      env: sanitizedChildEnv(process.env),
      stdio: "ignore",
    },
  );
  const previewFailed = new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      reject(
        new Error(
          `preview exited before capture (code=${exitCode ?? "none"}, signal=${signal ?? "none"})`,
        ),
      );
    });
  });
  const removeSignalForwarding = forwardParentSignals(child);

  let browser;
  try {
    await Promise.race([waitForHttp(url), previewFailed]);
    browser = await chromium.launch({ headless: true });
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      reducedMotion: "reduce",
      recordVideo: {
        dir: videosRoot,
        size: { width: 1280, height: 720 },
      },
    });
    await desktopContext.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    const page = await desktopContext.newPage();
    const video = page.video();
    await page.goto(url, { waitUntil: "networkidle" });
    const capturedNavigations = [page.url()];
    await page.screenshot({ path: heroPath });
    const flow = page.locator("#fluxo");
    await flow.waitFor({ state: "visible", timeout: 30_000 });
    await flow.scrollIntoViewIfNeeded();
    await flow.screenshot({ path: flowPath });
    const siteEvidence = page.locator("#evidencias");
    await siteEvidence.waitFor({ state: "visible", timeout: 30_000 });
    await siteEvidence.scrollIntoViewIfNeeded();
    await siteEvidence.screenshot({ path: siteEvidencePath });
    await page.evaluate(() =>
      window.scrollTo({ top: 0, behavior: "instant" }),
    );
    await page.screenshot({
      path: desktopPath,
      fullPage: true,
    });
    const pageHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    for (const ratio of [0.25, 0.5, 0.75, 1, 0]) {
      await page.evaluate(
        ({ height, position }) =>
          window.scrollTo({ top: height * position, behavior: "instant" }),
        { height: pageHeight, position: ratio },
      );
      await page.waitForTimeout(350);
    }
    await desktopContext.tracing.stop({ path: tracePath });
    await desktopContext.close();
    const recordedPath = await video.path();
    if (resolve(recordedPath) !== resolve(webmPath)) {
      await rename(recordedPath, webmPath);
    }

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(url, { waitUntil: "networkidle" });
    await mobilePage.screenshot({ path: mobilePath, fullPage: true });
    await mobileContext.close();

    await transcodeMp4(webmPath, mp4Path);
    await transcodeGifPreview(mp4Path, gifPreviewPath);
    await Promise.all([
      copyFile(heroPath, join(reportRoot, names.hero)),
      copyFile(flowPath, join(reportRoot, names.flow)),
      copyFile(siteEvidencePath, join(reportRoot, names.siteEvidence)),
      copyFile(desktopPath, join(reportRoot, names.full)),
      copyFile(mobilePath, join(reportRoot, names.mobileFull)),
      copyFile(webmPath, join(reportVideoRoot, names.video)),
      copyFile(mp4Path, join(reportVideoRoot, names.mp4)),
      copyFile(gifPreviewPath, join(reportVideoRoot, names.previewGif)),
    ]);
    const evidence = await writeEvidenceManifest({
      run,
      collected,
      evidenceRoot,
      navigations: capturedNavigations,
      names,
      paths: {
        hero: heroPath,
        flow: flowPath,
        site_evidence: siteEvidencePath,
        full: desktopPath,
        mobile_full: mobilePath,
        video: webmPath,
        mp4: mp4Path,
        trace: tracePath,
      },
    });
    const threadId =
      run.thread_id ?? collected.identity?.assistant_thread_id ?? null;
    if (!threadId) {
      throw new Error(`missing assistant thread id for evidence import: ${run.id}`);
    }
    const persisted = await api.request(
      `/assistant/threads/${encodeURIComponent(threadId)}/evidence`,
      { method: "POST", body: {} },
    );
    const evidenceRecords = await api.request(
      `/projects/${encodeURIComponent(manifest.project_slug)}/issues/${encodeURIComponent(run.issue_identifier)}/evidence`,
    );
    assertEvidenceTabRecord(evidenceRecords, {
      runId: persisted.run_id,
      threadId,
    });
    const evidenceContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      reducedMotion: "reduce",
    });
    await evidenceContext.addInitScript(
      ({ token }) => {
        window.localStorage.setItem("symphony.tracker.token", token);
      },
      { token: trackerToken },
    );
    const evidencePage = await evidenceContext.newPage();
    const evidenceUi = await verifyEvidenceTabUi(evidencePage, {
      baseUrl: trackerBaseUrl,
      projectSlug: manifest.project_slug,
      issueIdentifier: run.issue_identifier,
      runId: persisted.run_id,
    });
    await evidencePage.screenshot({
      path: evidenceTabPath,
      fullPage: true,
    });
    await evidenceContext.close();
    return {
      id: run.id,
      status: "captured",
      url,
      ...evidence,
      evidence_run_id: persisted.run_id,
      evidence_issue_identifier: run.issue_identifier,
      evidence_tab_verified: true,
      evidence_tab_route: evidenceUi.route,
      evidence_tab_screenshot: evidenceTabPath,
      evidence_rendered_screenshots: evidenceUi.screenshot_count,
      evidence_rendered_videos: evidenceUi.video_count,
    };
  } finally {
    try {
      await browser?.close();
    } finally {
      removeSignalForwarding();
      await stopProcessGroup(child);
    }
  }
}

export async function captureVisuals(env = process.env) {
  const runtimeRoot = resolve(env.SYMPHONY_BENCH_RUNTIME ?? "");
  if (!env.SYMPHONY_BENCH_RUNTIME?.trim()) {
    throw new Error("SYMPHONY_BENCH_RUNTIME is required");
  }
  const manifest = JSON.parse(
    await readFile(join(runtimeRoot, "runs.json"), "utf8"),
  );
  const reportRoot = join(runtimeRoot, "report", "screens");
  const reportVideoRoot = join(runtimeRoot, "report", "videos");
  await mkdir(reportRoot, { recursive: true });
  await mkdir(reportVideoRoot, { recursive: true });
  const api = createApi({
    baseUrl: env.SYMPHONY_BENCH_URL,
    token: env.SYMPHONY_BENCH_TOKEN,
  });

  const captures = await captureRunMatrix(
    manifest.runs,
    (run, index) =>
      captureRun({
        manifest,
        run,
        index,
        reportRoot,
        reportVideoRoot,
        api,
        trackerBaseUrl: env.SYMPHONY_BENCH_URL,
        trackerToken: env.SYMPHONY_BENCH_TOKEN,
      }),
  );
  await writeFile(
    join(runtimeRoot, "report", "visuals.json"),
    `${JSON.stringify(captures, null, 2)}\n`,
  );
  await writeFile(
    join(runtimeRoot, "report", "visual-comparison.md"),
    renderVisualComparison(captures),
  );
  return captures;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  captureVisuals()
    .then((captures) => {
      process.stdout.write(`${JSON.stringify(captures, null, 2)}\n`);
      if (captures.some((capture) => capture.status !== "captured")) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
