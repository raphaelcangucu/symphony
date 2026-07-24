import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const RUN_ID_PATTERN = /^(session|orchestrator)-(codex|cursor|claude)$/;

export function visualPort(index) {
  if (!Number.isInteger(index) || index < 0 || index > 99) {
    throw new Error(`invalid visual capture index: ${index}`);
  }
  return 23_000 + index;
}

export function visualScreenshotNames(runId) {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`invalid benchmark run id: ${runId}`);
  }
  return {
    hero: `${runId}-hero.png`,
    full: `${runId}-full.png`,
  };
}

export function renderVisualComparison(captures) {
  const lines = [
    "# Comparação visual padronizada",
    "",
    "Viewport: 1280 × 720, movimento reduzido, servidor isolado por célula.",
    "",
  ];
  for (const capture of captures) {
    lines.push(`## ${capture.id}`, "");
    if (capture.status === "captured") {
      lines.push(
        `![Hero de ${capture.id}](screens/${capture.id}-hero.png)`,
        "",
        `![Página completa de ${capture.id}](screens/${capture.id}-full.png)`,
      );
    } else {
      lines.push(`Captura indisponível: ${capture.status}.`);
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

async function waitForHttp(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`preview did not become ready at ${url}: ${lastError}`);
}

function workspaceForRun(manifest, run) {
  if (run.path === "session") return join(run.workspace_path, "site");
  return join(
    manifest.runtime_root,
    "workspaces",
    manifest.project_slug,
    run.issue_identifier.replace(/[^a-zA-Z0-9._-]/g, "_"),
    "site",
  );
}

async function captureRun({ manifest, run, index, reportRoot }) {
  const workspacePath = workspaceForRun(manifest, run);
  const collectedPath = join(
    manifest.runtime_root,
    "results",
    `${run.id}-collected.json`,
  );
  if (!(await exists(collectedPath))) return { id: run.id, status: "not-collected" };

  const collected = JSON.parse(await readFile(collectedPath, "utf8"));
  if (!collected.contract_passed) {
    return { id: run.id, status: "skipped-contract" };
  }

  const port = visualPort(index);
  const url = `http://127.0.0.1:${port}/`;
  const names = visualScreenshotNames(run.id);
  const child = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: workspacePath,
      detached: true,
      env: process.env,
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
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      reducedMotion: "reduce",
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(reportRoot, names.hero) });
    await page.screenshot({
      path: join(reportRoot, names.full),
      fullPage: true,
    });
    return {
      id: run.id,
      status: "captured",
      url,
      hero: join(reportRoot, names.hero),
      full: join(reportRoot, names.full),
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
  await mkdir(reportRoot, { recursive: true });

  const captures = [];
  for (const [index, run] of manifest.runs.entries()) {
    captures.push(await captureRun({ manifest, run, index, reportRoot }));
  }
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
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
