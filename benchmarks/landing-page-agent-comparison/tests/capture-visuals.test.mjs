import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

import * as captureVisuals from "../src/capture-visuals.mjs";
import {
  assertEvidenceTabRecord,
  captureRunMatrix,
  evidenceManifestForRun,
  previewArgs,
  renderVisualComparison,
  stopProcessGroup,
  visualPort,
  visualScreenshotNames,
  waitForHttp,
} from "../src/capture-visuals.mjs";

test("visual captures reserve a deterministic isolated port per matrix cell", () => {
  assert.equal(visualPort(0), 23_000);
  assert.equal(visualPort(5), 23_005);
  assert.throws(() => visualPort(-1), /invalid visual capture index/);
});

test("visual preview refuses to move to a different occupied port", () => {
  assert.deepEqual(previewArgs(23_004), [
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    "23004",
    "--strictPort",
  ]);
});

test("visual preview probe aborts an HTTP request that never answers", async () => {
  const server = createServer((_request, _response) => {});
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const { port } = server.address();

  try {
    const startedAt = Date.now();
    await assert.rejects(
      waitForHttp(`http://127.0.0.1:${port}/`, 250, {
        requestTimeoutMs: 75,
      }),
      /preview did not become ready/,
    );
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("visual capture records one failure and continues the remaining matrix", async () => {
  const captures = await captureRunMatrix(
    [
      { id: "session-codex-gpt5.5-medium" },
      { id: "session-cursor-composer2.5" },
    ],
    async (run) => {
      if (run.id === "session-codex-gpt5.5-medium")
        throw new Error("ffmpeg failed");
      return { id: run.id, status: "captured" };
    },
  );

  assert.deepEqual(captures, [
    {
      id: "session-codex-gpt5.5-medium",
      status: "capture-failed",
      error: "ffmpeg failed",
    },
    { id: "session-cursor-composer2.5", status: "captured" },
  ]);
});

test("visual capture rejects a blocked or incompletely validated benchmark cell", () => {
  assert.equal(typeof captureVisuals.assertCaptureEligible, "function");

  const run = {
    id: "session-cursor-composer2.5",
    provider: "cursor",
    requested_model: "composer-2.5",
    requested_effort: null,
  };
  const eligible = {
    status: "completed",
    contract_passed: true,
    agent_outcome: "completed",
    error: null,
    identity: {
      provider_matches: true,
      requested_model: "composer-2.5",
      requested_effort: null,
      resolved_model: "composer-2.5",
      resolved_effort: null,
    },
    validation: [
      { command: "npm install", status: "passed" },
      { command: "npm run build", status: "passed" },
      { command: "npm run test:e2e", status: "passed" },
    ],
  };

  assert.doesNotThrow(() => captureVisuals.assertCaptureEligible(eligible, run));
  assert.throws(
    () =>
      captureVisuals.assertCaptureEligible(
        { ...eligible, status: "blocked", error: "provider failed" },
        run,
      ),
    /not eligible for evidence capture/,
  );
  assert.throws(
    () =>
      captureVisuals.assertCaptureEligible(
        {
          ...eligible,
          validation: eligible.validation.map((step, index) =>
            index === 2 ? { ...step, status: "failed" } : step,
          ),
        },
        run,
      ),
    /not eligible for evidence capture/,
  );
});

test("visual captures use safe stable report names", () => {
  assert.deepEqual(
    visualScreenshotNames("orchestrator-claude-opus5-high"),
    {
      hero: "orchestrator-claude-opus5-high-hero.png",
      full: "orchestrator-claude-opus5-high-full.png",
      mobileFull: "orchestrator-claude-opus5-high-mobile-full.png",
      evidenceTab:
        "orchestrator-claude-opus5-high-evidence-tab.png",
      video: "orchestrator-claude-opus5-high-e2e.webm",
      mp4: "orchestrator-claude-opus5-high-e2e.mp4",
      previewGif: "orchestrator-claude-opus5-high-e2e-preview.gif",
    },
  );
  assert.throws(
    () => visualScreenshotNames("../../escape"),
    /invalid benchmark run id/,
  );
});

test("visual report preserves captured and blocked cells", () => {
  const report = renderVisualComparison([
    { id: "session-codex-gpt5.6.sol-low", status: "captured" },
    { id: "session-cursor-composer2.5", status: "skipped-contract" },
  ]);
  assert.match(report, /screens\/session-codex-gpt5\.6\.sol-low-hero\.png/);
  assert.match(
    report,
    /screens\/session-codex-gpt5\.6\.sol-low-mobile-full\.png/,
  );
  assert.match(
    report,
    /\[!\[Prévia animada de session-codex-gpt5\.6\.sol-low\]\(videos\/session-codex-gpt5\.6\.sol-low-e2e-preview\.gif\)\]\(videos\/session-codex-gpt5\.6\.sol-low-e2e\.mp4\)/,
  );
  assert.doesNotMatch(report, /<video/);
  assert.match(report, /videos\/session-codex-gpt5\.6\.sol-low-e2e\.mp4/);
  assert.match(report, /session-cursor-composer2\.5/);
  assert.match(report, /skipped-contract/);
});

test("canonical manifest exposes desktop, mobile, WebM, MP4, trace, and real navigation", () => {
  const run = {
    id: "session-cursor-composer2.5",
    issue_identifier: "SYM-2",
  };
  const names = visualScreenshotNames(run.id);
  const manifest = evidenceManifestForRun({
    run,
    names,
    navigations: ["http://127.0.0.1:23001/observed-by-playwright"],
    collected: {
      validation: [
        {
          command: "npm run build",
          status: "passed",
          duration_ms: 10,
        },
        {
          command: "npm run test:e2e",
          status: "passed",
          duration_ms: 20,
        },
      ],
    },
  });

  const e2e = manifest.runs.find((runEntry) => runEntry.kind === "e2e");
  assert.equal(manifest.issue, "SYM-2");
  assert.equal(e2e.status, "passed");
  assert.deepEqual(
    e2e.screenshots.map((entry) => entry.path),
    [
      "artifacts/screens/session-cursor-composer2.5-full.png",
      "artifacts/screens/session-cursor-composer2.5-mobile-full.png",
    ],
  );
  assert.deepEqual(
    e2e.videos.map((entry) => entry.path),
    [
      "artifacts/videos/session-cursor-composer2.5-e2e.webm",
      "artifacts/videos/session-cursor-composer2.5-e2e.mp4",
    ],
  );
  assert.equal(
    e2e.trace,
    "artifacts/traces/session-cursor-composer2.5-e2e.zip",
  );
  assert.deepEqual(e2e.navigations, [
    "http://127.0.0.1:23001/observed-by-playwright",
  ]);
  assert.equal(e2e.proof.full_page, true);
});

test("Evidence-tab verification navigates the real UI and requires rendered media", async () => {
  assert.equal(typeof captureVisuals.verifyEvidenceTabUi, "function");

  const calls = [];
  const card = {
    waitFor: async (options) => calls.push(["waitFor", options]),
    locator: (selector) => ({
      count: async () => (selector === "img" || selector === "video" ? 2 : 0),
    }),
  };
  const page = {
    goto: async (url, options) => calls.push(["goto", url, options]),
    getByTestId: (testId) => {
      calls.push(["getByTestId", testId]);
      return card;
    },
    waitForFunction: async (_predicate, argument, options) =>
      calls.push(["waitForFunction", argument, options]),
  };

  const result = await captureVisuals.verifyEvidenceTabUi(page, {
    baseUrl: "http://127.0.0.1:4010",
    projectSlug: "symphony benchmark",
    issueIdentifier: "SYM-2",
    runId: "20260725-1",
  });

  assert.equal(
    result.route,
    "http://127.0.0.1:4010/tracker/projects/symphony%20benchmark/board/issues/SYM-2/evidence",
  );
  assert.equal(result.screenshot_count, 2);
  assert.equal(result.video_count, 2);
  assert.deepEqual(calls[0], [
    "goto",
    result.route,
    { waitUntil: "domcontentloaded" },
  ]);
  assert.deepEqual(calls[1], ["getByTestId", "evidence-20260725-1"]);
});

test("Evidence-tab verification requires the persisted visual contract", () => {
  const record = {
    run_id: "run-1",
    session_id: "33",
    status: "passed",
    manifest: {
      runs: [
        {
          kind: "e2e",
          status: "passed",
          screenshots: [{ path: "desktop.png" }, { path: "mobile.png" }],
          videos: [{ path: "flow.webm" }, { path: "flow.mp4" }],
          trace: "trace.zip",
        },
      ],
    },
  };

  assert.equal(
    assertEvidenceTabRecord([record], {
      runId: "run-1",
      threadId: 33,
    }),
    record,
  );
  assert.throws(
    () =>
      assertEvidenceTabRecord(
        [{ ...record, manifest: { runs: [] } }],
        { runId: "run-1", threadId: 33 },
      ),
    /missing its E2E run/,
  );
});

test("visual capture escalates cleanup when a preview ignores SIGTERM", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 30_000)"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));

  await stopProcessGroup(child);

  assert.notEqual(child.signalCode, null);
});
