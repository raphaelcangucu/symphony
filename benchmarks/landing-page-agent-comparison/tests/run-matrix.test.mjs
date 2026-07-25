import assert from "node:assert/strict";
import test from "node:test";

import {
  parseConcurrency,
  runWithConcurrency,
  selectMatrixRuns,
} from "../src/run-matrix.mjs";

const manifest = {
  runs: [
    { id: "session-codex-gpt5.5-medium", matrix: "providers-default" },
    { id: "session-claude-sonnet5-medium", matrix: "providers-default" },
    { id: "session-codex-gpt5.5-high", matrix: "providers-advanced" },
  ],
};

test("selectMatrixRuns returns one explicit non-empty matrix in manifest order", () => {
  assert.deepEqual(
    selectMatrixRuns(manifest, "providers-default").map((run) => run.id),
    ["session-codex-gpt5.5-medium", "session-claude-sonnet5-medium"],
  );
  assert.throws(
    () => selectMatrixRuns(manifest, "missing"),
    /benchmark matrix has no runs/,
  );
});

test("parseConcurrency requires a small positive integer", () => {
  assert.equal(parseConcurrency(undefined), 1);
  assert.equal(parseConcurrency("3"), 3);
  assert.throws(() => parseConcurrency("0"), /positive integer/);
  assert.throws(() => parseConcurrency("2.5"), /positive integer/);
  assert.throws(() => parseConcurrency("9"), /at most 6/);
});

test("runWithConcurrency bounds parallel cells and reports every failure", async () => {
  let active = 0;
  let peak = 0;
  const completed = [];

  await assert.rejects(
    runWithConcurrency(["a", "b", "c", "d"], 2, async (id) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      completed.push(id);
      if (id === "b" || id === "d") throw new Error(`failed ${id}`);
    }),
    /b: failed b[\s\S]*d: failed d/,
  );

  assert.equal(peak, 2);
  assert.deepEqual(completed.sort(), ["a", "b", "c", "d"]);
});
