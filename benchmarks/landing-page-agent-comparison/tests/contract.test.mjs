import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as benchmarkContract from "../src/contract.mjs";

const {
  PATHS,
  PROVIDERS,
  RUN_MATRIX,
  promptSha256,
  readCanonicalPrompt,
} = benchmarkContract;

test("keeps the 18 historical runs and adds 6 focused high-effort runs", () => {
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
      "session-codex-gpt5.6.sol-high-dev10x",
      "session-cursor-grok4.5-high-dev10x",
      "session-claude-opus5-high-dev10x",
      "orchestrator-codex-gpt5.6.sol-high-dev10x",
      "orchestrator-cursor-grok4.5-high-dev10x",
      "orchestrator-claude-opus5-high-dev10x",
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

test("defines one reproducible Dev10x brand matrix with all providers at high", () => {
  assert.equal(benchmarkContract.DEFAULT_MATRIX, "dev10x-brand-high");
  assert.equal(typeof benchmarkContract.runsForMatrix, "function");

  const selected =
    typeof benchmarkContract.runsForMatrix === "function"
      ? benchmarkContract.runsForMatrix("dev10x-brand-high")
      : [];

  assert.deepEqual(
    selected.map(
      ({ path, provider, requested_model, requested_effort }) => [
        path,
        provider,
        requested_model,
        requested_effort,
      ],
    ),
    [
      ["session", "codex", "gpt-5.6-sol", "high"],
      ["session", "cursor", "cursor-grok-4.5-high", null],
      ["session", "claude", "claude-opus-5", "high"],
      ["orchestrator", "codex", "gpt-5.6-sol", "high"],
      ["orchestrator", "cursor", "cursor-grok-4.5-high", null],
      ["orchestrator", "claude", "claude-opus-5", "high"],
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
  assert.match(prompt, /public\/dev10x\/dev10x_logo_color\.png/);
  assert.match(prompt, /src="\/dev10x\/dev10x_logo_color\.png"/);
  assert.match(prompt, /#0F172A/);
  assert.match(prompt, /#7C3AED/);
  assert.match(prompt, /#2563EB/);
  assert.match(prompt, /#38BDF8/);
  assert.match(prompt, /#FFFFFF/);
  assert.match(prompt, /não redesenhe/i);
  assert.match(prompt, /id="visao"/);
  assert.match(prompt, /id="fluxo"/);
  assert.match(prompt, /id="agentes"/);
  assert.match(prompt, /id="evidencias"/);
  assert.doesNotMatch(prompt, /marca [“"]Symphony[”"]/);
  assert.equal(promptSha256(prompt).length, 64);
});

test("the README documents the focused six-cell Dev10x matrix", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /dev10x-brand-high/);
  assert.match(readme, /gpt-5\.6-sol.*high/s);
  assert.match(readme, /cursor-grok-4\.5-high/);
  assert.match(readme, /claude-opus-5.*high/s);
  assert.match(readme, /6 células/);
});
