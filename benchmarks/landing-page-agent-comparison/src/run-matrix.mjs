import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { executeProcess } from "./process.mjs";
import { MATRIX_CELL_TIMEOUT_MS } from "./timeouts.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runCellPath = join(packageRoot, "src", "run-cell.mjs");

export function selectMatrixRuns(manifest, matrix) {
  const runs = (manifest?.runs ?? []).filter((run) => run.matrix === matrix);
  if (runs.length === 0) {
    throw new Error(`benchmark matrix has no runs: ${matrix}`);
  }
  return runs;
}

export function parseConcurrency(value) {
  if (value == null || String(value).trim() === "") return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("SYMPHONY_BENCH_CONCURRENCY must be a positive integer");
  }
  if (parsed > 6) {
    throw new Error("SYMPHONY_BENCH_CONCURRENCY must be at most 6");
  }
  return parsed;
}

export async function runWithConcurrency(items, concurrency, worker) {
  const failures = [];
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await worker(item);
      } catch (error) {
        failures.push({
          id: item?.id ?? String(item),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));

  if (failures.length > 0) {
    throw new Error(
      `benchmark cells failed:\n${failures
        .map(({ id, message }) => `- ${id}: ${message}`)
        .join("\n")}`,
    );
  }
}

export async function runMatrix(env = process.env) {
  const runtimeRoot = env.SYMPHONY_BENCH_RUNTIME?.trim();
  const matrix = env.SYMPHONY_BENCH_MATRIX?.trim();
  if (!runtimeRoot || !matrix) {
    throw new Error("SYMPHONY_BENCH_RUNTIME and SYMPHONY_BENCH_MATRIX are required");
  }

  const manifest = JSON.parse(await readFile(join(resolve(runtimeRoot), "runs.json"), "utf8"));

  const runs = selectMatrixRuns(manifest, matrix);
  const concurrency = parseConcurrency(env.SYMPHONY_BENCH_CONCURRENCY);

  await runWithConcurrency(runs, concurrency, async (run) => {
    const result = await executeProcess(process.execPath, [runCellPath], {
      cwd: packageRoot,
      env: {
        ...env,
        SYMPHONY_BENCH_RUN_ID: run.id,
      },
      timeout: MATRIX_CELL_TIMEOUT_MS,
      onStdout: (text) => process.stdout.write(text),
      onStderr: (text) => process.stderr.write(text),
    });

    if (result.status !== "passed") {
      throw new Error(
        `benchmark cell failed: ${run.id} (${result.status}, exit ${result.exit_code})`,
      );
    }
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (invokedPath === import.meta.url) {
  runMatrix().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
