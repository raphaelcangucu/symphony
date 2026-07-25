import assert from "node:assert/strict";
import test from "node:test";

import {
  PATHS,
  PROVIDERS,
  RUN_MATRIX,
  promptSha256,
  readCanonicalPrompt,
} from "../src/contract.mjs";

test("defines 15 unique model-pinned benchmark runs", () => {
  assert.equal(RUN_MATRIX.length, 15);
  assert.equal(new Set(RUN_MATRIX.map((run) => run.id)).size, 15);
  assert.deepEqual(
    new Set(RUN_MATRIX.map((run) => run.provider)),
    new Set(PROVIDERS),
  );
  assert.deepEqual(new Set(RUN_MATRIX.map((run) => run.path)), new Set(PATHS));

  assert.equal(
    RUN_MATRIX.filter((run) => run.matrix === "providers-default").length,
    6,
  );
  assert.equal(
    RUN_MATRIX.filter((run) => run.matrix === "providers-advanced").length,
    6,
  );
  assert.equal(
    RUN_MATRIX.filter((run) => run.matrix === "codex-5.6-defaults").length,
    3,
  );
  assert.equal(
    RUN_MATRIX.every((run) => run.requested_model),
    true,
  );

  assert.deepEqual(
    RUN_MATRIX.filter(
      (run) => run.matrix === "providers-advanced" && run.path === "session",
    ).map(({ provider, requested_model, requested_effort }) => [
      provider,
      requested_model,
      requested_effort,
    ]),
    [
      ["codex", "gpt-5.5", "high"],
      ["cursor", "cursor-grok-4.5-high", null],
      ["claude", "claude-opus-5", "high"],
    ],
  );

  assert.deepEqual(
    RUN_MATRIX.filter((run) => run.matrix === "codex-5.6-defaults").map(
      ({ requested_model, requested_effort }) => [
        requested_model,
        requested_effort,
      ],
    ),
    [
      ["gpt-5.6-sol", "low"],
      ["gpt-5.6-terra", "medium"],
      ["gpt-5.6-luna", "medium"],
    ],
  );
});

test("the canonical prompt requires preview-compatible Playwright E2E", async () => {
  const prompt = await readCanonicalPrompt();

  assert.match(prompt, /Playwright/);
  assert.match(prompt, /npm run dev -- --host 0\.0\.0\.0/);
  assert.match(prompt, /test:e2e/);
  assert.match(prompt, /node scripts\/run-e2e\.mjs/);
  assert.match(prompt, /Não configure `webServer`/);
  assert.match(prompt, /Codex, Cursor e Claude/);
  assert.equal(promptSha256(prompt).length, 64);
});
