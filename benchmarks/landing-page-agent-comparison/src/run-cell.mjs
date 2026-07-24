import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function selectRun(manifest, runId) {
  const matches = manifest?.runs?.filter((run) => run.id === runId) ?? [];
  if (matches.length !== 1) {
    throw new Error(`unknown benchmark run: ${runId}`);
  }
  return matches[0];
}

export function artifactSlug(runId) {
  if (!/^(session|orchestrator)-(codex|cursor|claude)$/.test(runId)) {
    throw new Error(`invalid benchmark run id: ${runId}`);
  }
  return runId;
}

export function sessionRoute(projectSlug, threadId) {
  return `/tracker/projects/${encodeURIComponent(projectSlug)}/workspaces/${encodeURIComponent(threadId)}`;
}

export function issueRoute(projectSlug, identifier) {
  return `/tracker/projects/${encodeURIComponent(projectSlug)}/board/issues/${encodeURIComponent(identifier)}/sessions?surface=autonomous`;
}

export function classifySessionOutcome(initialMessageCount, finalMessageCount) {
  return finalMessageCount > initialMessageCount ? "completed" : "failed";
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
  return new Promise((resolvePromise) => {
    const child = execFile(
      "npx",
      ["playwright", "test", "e2e/symphony-flow.spec.mjs", "--workers=1"],
      {
        cwd: packageRoot,
        env,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error) => {
        resolvePromise(error?.code ?? 0);
      },
    );
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export async function runCell(env = process.env) {
  const { runtimeRoot, runId } = requiredEnvironment(env);
  const manifest = JSON.parse(await readFile(join(runtimeRoot, "runs.json"), "utf8"));
  selectRun(manifest, runId);

  const artifactRoot = join(runtimeRoot, "artifacts", runId);
  const resultPath = join(runtimeRoot, "results", `${runId}.json`);
  await mkdir(artifactRoot, { recursive: true });

  const exitCode = await executePlaywright({
    ...env,
    SYMPHONY_BENCH_RUN_ID: runId,
    SYMPHONY_BENCH_ARTIFACT_ROOT: artifactRoot,
  });

  try {
    await readFile(resultPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(
      resultPath,
      `${JSON.stringify(
        {
          id: runId,
          status: "blocked",
          finished_at: new Date().toISOString(),
          error: `Playwright exited with code ${exitCode} before writing a result`,
          artifact_root: artifactRoot,
        },
        null,
        2,
      )}\n`,
    );
  }

  return exitCode;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  runCell().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
