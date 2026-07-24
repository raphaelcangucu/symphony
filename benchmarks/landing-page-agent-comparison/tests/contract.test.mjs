import assert from "node:assert/strict";
import test from "node:test";

import {
  PATHS,
  PROVIDERS,
  RUN_MATRIX,
  promptSha256,
  readCanonicalPrompt,
} from "../src/contract.mjs";

test("defines six unique session and orchestrator provider runs", () => {
  assert.equal(RUN_MATRIX.length, 6);
  assert.equal(new Set(RUN_MATRIX.map((run) => run.id)).size, 6);
  assert.deepEqual(new Set(RUN_MATRIX.map((run) => run.provider)), new Set(PROVIDERS));
  assert.deepEqual(new Set(RUN_MATRIX.map((run) => run.path)), new Set(PATHS));
});

test("the canonical prompt requires preview-compatible Playwright E2E", async () => {
  const prompt = await readCanonicalPrompt();

  assert.match(prompt, /Playwright/);
  assert.match(prompt, /npm run dev -- --host 0\.0\.0\.0/);
  assert.match(prompt, /test:e2e/);
  assert.match(prompt, /Codex, Cursor e Claude/);
  assert.equal(promptSha256(prompt).length, 64);
});
