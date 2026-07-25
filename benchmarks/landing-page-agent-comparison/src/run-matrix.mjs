import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { executeProcess } from "./process.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runCellPath = join(packageRoot, "src", "run-cell.mjs");
const CELL_TIMEOUT_MS = 60 * 60 * 1000;

export function selectMatrixRuns(manifest, matrix) {
  const runs = (manifest?.runs ?? []).filter((run) => run.matrix === matrix);
  if (runs.length === 0) {
    throw new Error(`benchmark matrix has no runs: ${matrix}`);
  }
  return runs;
}

export async function runMatrix(env = process.env) {
  const runtimeRoot = env.SYMPHONY_BENCH_RUNTIME?.trim();
  const matrix = env.SYMPHONY_BENCH_MATRIX?.trim();
  if (!runtimeRoot || !matrix) {
    throw new Error(
      "SYMPHONY_BENCH_RUNTIME and SYMPHONY_BENCH_MATRIX are required",
    );
  }

  const manifest = JSON.parse(
    await readFile(join(resolve(runtimeRoot), "runs.json"), "utf8"),
  );

  for (const run of selectMatrixRuns(manifest, matrix)) {
    const result = await executeProcess(process.execPath, [runCellPath], {
      cwd: packageRoot,
      env: {
        ...env,
        SYMPHONY_BENCH_RUN_ID: run.id,
      },
      timeout: CELL_TIMEOUT_MS,
      onStdout: (text) => process.stdout.write(text),
      onStderr: (text) => process.stderr.write(text),
    });

    if (result.status !== "passed") {
      throw new Error(
        `benchmark cell failed: ${run.id} (${result.status}, exit ${result.exit_code})`,
      );
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  runMatrix().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
