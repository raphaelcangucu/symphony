import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { inspectWorkspace, renderComparison } from "../src/collect.mjs";

test("inspectWorkspace reports generated landing and E2E contracts", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "symphony-collect-"));
  await mkdir(join(workspace, "src"));
  await mkdir(join(workspace, "tests", "e2e"), { recursive: true });
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      scripts: {
        dev: "vite",
        build: "vite build",
        "test:e2e": "playwright test",
      },
    }),
  );
  await writeFile(join(workspace, "src", "App.tsx"), "export function App() {}\n");
  await writeFile(join(workspace, "playwright.config.ts"), "export default {};\n");
  await writeFile(join(workspace, "tests", "e2e", "landing.spec.ts"), "test('landing', () => {});\n");

  const facts = await inspectWorkspace(workspace);

  assert.equal(facts.exists, true);
  assert.equal(facts.contract.package_json, true);
  assert.equal(facts.contract.source, true);
  assert.equal(facts.contract.playwright_config, true);
  assert.equal(facts.contract.e2e_tests, true);
  assert.deepEqual(facts.contract.scripts, {
    dev: true,
    build: true,
    test_e2e: true,
  });
  assert.equal(facts.file_count, 4);
});

test("renderComparison preserves blocked cells and the shared prompt hash", () => {
  const report = renderComparison({
    prompt_sha256: "abc123",
    rows: [
      {
        id: "session-codex",
        path: "session",
        provider: "codex",
        status: "completed",
        duration_ms: 1234,
        workspace_path: "/tmp/codex",
        contract_passed: true,
      },
      {
        id: "orchestrator-claude",
        path: "orchestrator",
        provider: "claude",
        status: "blocked",
        duration_ms: 4321,
        workspace_path: "/tmp/claude",
        contract_passed: false,
      },
    ],
  });

  assert.match(report, /Prompt SHA-256: `abc123`/);
  assert.match(report, /session-codex.*completed/);
  assert.match(report, /orchestrator-claude.*blocked/);
  assert.match(report, /Revisão visual humana/);
});
