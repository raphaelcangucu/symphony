import assert from "node:assert/strict";
import test from "node:test";

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  executeValidation,
  formatDuration,
  gitFacts,
  inspectWorkspace,
  inventoryArtifacts,
  renderComparison,
  observedExecutionDuration,
  resolveRunIdentity,
  summarizeAttempts,
  validationPort,
} from "../src/collect.mjs";

test("independent validation reserves one deterministic port per cell", () => {
  assert.equal(validationPort(0), 24_000);
  assert.equal(validationPort(5), 24_005);
  assert.throws(() => validationPort(-1), /invalid validation index/);
});

test("inspectWorkspace reports generated landing and E2E contracts", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "symphony-collect-"));
  await mkdir(join(workspace, "src"));
  await mkdir(join(workspace, "tests", "e2e"), { recursive: true });
  await mkdir(join(workspace, "scripts"));
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      scripts: {
        dev: "vite",
        build: "vite build",
        "test:e2e": "node scripts/run-e2e.mjs",
      },
    }),
  );
  await writeFile(
    join(workspace, "scripts", "run-e2e.mjs"),
    "const controller = new AbortController();\nconst args = ['--strictPort'];\n",
  );
  await writeFile(
    join(workspace, "src", "App.tsx"),
    "export function App() {}\n",
  );
  await writeFile(
    join(workspace, "playwright.config.ts"),
    "export default {};\n",
  );
  await writeFile(
    join(workspace, "tests", "e2e", "landing.spec.ts"),
    "test('landing', () => {});\n",
  );

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
    e2e_runner: true,
  });
  assert.equal(facts.file_count, 5);
});

test("inspectWorkspace rejects a direct Playwright script without the safe runner", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "symphony-unsafe-e2e-"));
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
  await writeFile(
    join(workspace, "src", "App.tsx"),
    "export function App() {}\n",
  );
  await writeFile(
    join(workspace, "playwright.config.ts"),
    "export default {};\n",
  );
  await writeFile(
    join(workspace, "tests", "e2e", "landing.spec.ts"),
    "test('landing', () => {});\n",
  );

  const facts = await inspectWorkspace(workspace);

  assert.equal(facts.contract.scripts.test_e2e, false);
  assert.equal(facts.contract.scripts.e2e_runner, false);
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
  assert.match(report, /1s/);
  assert.match(report, /Revisão visual humana/);
});

test("formatDuration renders benchmark timings for humans", () => {
  assert.equal(formatDuration(19_973), "20s");
  assert.equal(formatDuration(689_435), "11m 29s");
  assert.equal(formatDuration(3_661_000), "1h 1m 1s");
  assert.equal(formatDuration(null), "n/a");
});

test("executeValidation completes when a successful command leaves a stdio child behind", async () => {
  const startedAt = Date.now();
  const result = await executeValidation(
    process.execPath,
    [
      "-e",
      `
        const { spawn } = require("node:child_process");
        spawn(process.execPath, ["-e", "setInterval(() => {}, 30_000)"], {
          stdio: "inherit",
        });
        setTimeout(() => process.exit(0), 100);
      `,
    ],
    process.cwd(),
    2_000,
  );

  assert.equal(result.status, "passed");
  assert.equal(result.exit_code, 0);
  assert.ok(Date.now() - startedAt < 1_500);
});

test("executeValidation times out and terminates a wedged process group", async () => {
  const result = await executeValidation(
    process.execPath,
    ["-e", "setInterval(() => {}, 30_000)"],
    process.cwd(),
    100,
  );

  assert.equal(result.status, "timed_out");
  assert.ok(result.duration_ms < 2_000);
});

test("gitFacts reports unavailable Git state honestly", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "symphony-no-git-"));
  const facts = await gitFacts(workspace);

  assert.equal(facts.available, false);
  assert.equal(facts.changed_lines, null);
  assert.match(facts.reason, /not a Git working tree/);
});

test("gitFacts counts every untracked file instead of collapsing directories", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "symphony-git-facts-"));
  await executeValidation("git", ["init"], workspace, 5_000);
  await executeValidation(
    "git",
    ["config", "user.email", "benchmark@example.test"],
    workspace,
    5_000,
  );
  await executeValidation(
    "git",
    ["config", "user.name", "Symphony Benchmark"],
    workspace,
    5_000,
  );
  await writeFile(join(workspace, "base.txt"), "base\n");
  await executeValidation("git", ["add", "base.txt"], workspace, 5_000);
  await executeValidation("git", ["commit", "-m", "base"], workspace, 5_000);
  await mkdir(join(workspace, "nested"));
  await writeFile(join(workspace, "nested", "one.txt"), "one\n");
  await writeFile(join(workspace, "nested", "two.txt"), "two\n");

  const facts = await gitFacts(workspace);

  assert.equal(facts.available, true);
  assert.equal(facts.changed_files, 2);
  assert.equal(facts.changed_lines, 2);
  assert.equal(facts.clean, false);
});

test("inventoryArtifacts records concrete generated evidence paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "symphony-artifacts-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", "landing.png"), "png");
  await writeFile(join(root, "nested", "landing.webm"), "video");
  await writeFile(join(root, "nested", "landing.mp4"), "mp4");
  await writeFile(join(root, "nested", "landing.zip"), "trace");

  const inventory = await inventoryArtifacts([
    { source: "generated_e2e", root },
  ]);

  assert.deepEqual(inventory.screenshots, [
    {
      source: "generated_e2e",
      path: join(root, "nested", "landing.png"),
    },
  ]);
  assert.deepEqual(
    inventory.videos.map((item) => item.path),
    [join(root, "nested", "landing.mp4"), join(root, "nested", "landing.webm")],
  );
  assert.equal(inventory.traces[0].path, join(root, "nested", "landing.zip"));
});

test("summarizeAttempts lists immutable attempts without mixing their metrics", () => {
  assert.deepEqual(
    summarizeAttempts(
      [
        {
          attempt_id: "generation",
          duration_ms: 680_517,
          artifact_root: "/tmp/generation",
        },
        {
          attempt_id: "terminal-snapshot",
          duration_ms: 3_535,
          artifact_root: "/tmp/terminal",
        },
      ],
      "terminal-snapshot",
    ),
    {
      count: 2,
      canonical_attempt_id: "terminal-snapshot",
      attempt_ids: ["generation", "terminal-snapshot"],
    },
  );
  assert.deepEqual(summarizeAttempts([]), {
    count: 0,
    canonical_attempt_id: null,
    attempt_ids: [],
  });
});

test("resolveRunIdentity labels manifest-only session identity without inventing status", () => {
  assert.deepEqual(
    resolveRunIdentity(
      { path: "session", provider: "codex", thread_id: 41 },
      {},
    ),
    {
      assistant_thread_id: 41,
      agent_kind: "codex",
      status: null,
      provider_matches: null,
      requested_model: null,
      requested_effort: null,
      resolved_model: null,
      resolved_effort: null,
      source: "manifest",
    },
  );
  assert.equal(
    resolveRunIdentity(
      { path: "orchestrator", provider: "claude" },
      { identity: { assistant_thread_id: 9, status: "error" } },
    ).status,
    "error",
  );
});

test("observedExecutionDuration derives only the canonical backend execution", () => {
  assert.equal(
    observedExecutionDuration({
      duration_ms: 3_535,
      identity: { agent_execution_runtime_seconds: 680 },
    }),
    680_000,
  );
  assert.equal(
    observedExecutionDuration({
      duration_ms: 2_527,
      identity: {
        agent_execution_started_at: "2026-07-24T14:59:24Z",
        agent_execution_last_event_at: "2026-07-24T15:05:53Z",
      },
    }),
    389_000,
  );
  assert.equal(observedExecutionDuration({ duration_ms: 3_535 }), null);
});
