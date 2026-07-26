import assert from "node:assert/strict";
import test from "node:test";

import {
  PATHS,
  PROVIDERS,
  RUN_MATRIX,
  promptSha256,
  readCanonicalPrompt,
} from "../src/contract.mjs";

test("defines the historical matrices plus 6 current provider defaults", () => {
  assert.equal(RUN_MATRIX.length, 24);
  assert.equal(new Set(RUN_MATRIX.map((run) => run.id)).size, 24);
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
    6,
  );
  assert.equal(
    RUN_MATRIX.filter((run) => run.matrix === "providers-current-default").length,
    6,
  );
  assert.equal(
    RUN_MATRIX.every((run) => run.requested_model),
    true,
  );
  assert.deepEqual(
    RUN_MATRIX.map((run) => run.id),
    [
      "session-codex-gpt5.5-medium",
      "session-cursor-composer2.5",
      "session-claude-sonnet5-medium",
      "orchestrator-codex-gpt5.5-medium",
      "orchestrator-cursor-composer2.5",
      "orchestrator-claude-sonnet5-medium",
      "session-codex-gpt5.5-high",
      "session-cursor-grok4.5-high",
      "session-claude-opus5-high",
      "orchestrator-codex-gpt5.5-high",
      "orchestrator-cursor-grok4.5-high",
      "orchestrator-claude-opus5-high",
      "session-codex-gpt5.6.sol-low",
      "orchestrator-codex-gpt5.6.sol-low",
      "session-codex-gpt5.6.terra-medium",
      "orchestrator-codex-gpt5.6.terra-medium",
      "session-codex-gpt5.6.luna-medium",
      "orchestrator-codex-gpt5.6.luna-medium",
      "session-default-codex-gpt5.6.sol-low",
      "session-default-cursor-auto",
      "session-default-claude-opus5-xhigh",
      "orchestrator-default-codex-gpt5.6.sol-low",
      "orchestrator-default-cursor-auto",
      "orchestrator-default-claude-opus5-xhigh",
    ],
  );

  assert.deepEqual(
    RUN_MATRIX.filter(
      (run) =>
        run.matrix === "providers-current-default" && run.path === "session",
    ).map(({ provider, requested_model, requested_effort }) => [
      provider,
      requested_model,
      requested_effort,
    ]),
    [
      ["codex", "gpt-5.6-sol", "low"],
      ["cursor", "auto", null],
      ["claude", "claude-opus-5", "xhigh"],
    ],
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
      ({ path, requested_model, requested_effort }) => [
        path,
        requested_model,
        requested_effort,
      ],
    ),
    [
      ["session", "gpt-5.6-sol", "low"],
      ["orchestrator", "gpt-5.6-sol", "low"],
      ["session", "gpt-5.6-terra", "medium"],
      ["orchestrator", "gpt-5.6-terra", "medium"],
      ["session", "gpt-5.6-luna", "medium"],
      ["orchestrator", "gpt-5.6-luna", "medium"],
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
  assert.match(prompt, /Dev10x/);
  assert.doesNotMatch(prompt, /marca [“"]Symphony[”"]/);
  assert.equal(promptSha256(prompt).length, 64);
});
