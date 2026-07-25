import assert from "node:assert/strict";
import test from "node:test";

import { selectMatrixRuns } from "../src/run-matrix.mjs";

const manifest = {
  runs: [
    { id: "providers-default-session-codex", matrix: "providers-default" },
    { id: "providers-default-session-claude", matrix: "providers-default" },
    { id: "providers-advanced-session-codex", matrix: "providers-advanced" },
  ],
};

test("selectMatrixRuns returns one explicit non-empty matrix in manifest order", () => {
  assert.deepEqual(
    selectMatrixRuns(manifest, "providers-default").map((run) => run.id),
    ["providers-default-session-codex", "providers-default-session-claude"],
  );
  assert.throws(
    () => selectMatrixRuns(manifest, "missing"),
    /benchmark matrix has no runs/,
  );
});
