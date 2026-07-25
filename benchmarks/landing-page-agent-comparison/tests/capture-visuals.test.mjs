import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

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
    [{ id: "session-codex" }, { id: "session-cursor" }],
    async (run) => {
      if (run.id === "session-codex") throw new Error("ffmpeg failed");
      return { id: run.id, status: "captured" };
    },
  );

  assert.deepEqual(captures, [
    {
      id: "session-codex",
      status: "capture-failed",
      error: "ffmpeg failed",
    },
    { id: "session-cursor", status: "captured" },
  ]);
});

test("visual captures use safe stable report names", () => {
  assert.deepEqual(visualScreenshotNames("orchestrator-claude"), {
    hero: "orchestrator-claude-hero.png",
    full: "orchestrator-claude-full.png",
    mobileFull: "orchestrator-claude-mobile-full.png",
    video: "orchestrator-claude-e2e.webm",
    mp4: "orchestrator-claude-e2e.mp4",
  });
  assert.throws(
    () => visualScreenshotNames("../../escape"),
    /invalid benchmark run id/,
  );
});

test("visual report preserves captured and blocked cells", () => {
  const report = renderVisualComparison([
    { id: "session-codex", status: "captured" },
    { id: "session-cursor", status: "skipped-contract" },
  ]);
  assert.match(report, /screens\/session-codex-hero\.png/);
  assert.match(report, /screens\/session-codex-mobile-full\.png/);
  assert.match(report, /videos\/session-codex-e2e\.mp4/);
  assert.match(report, /session-cursor/);
  assert.match(report, /skipped-contract/);
});

test("canonical manifest exposes desktop, mobile, WebM, MP4, trace, and real navigation", () => {
  const run = {
    id: "session-cursor",
    issue_identifier: "SYM-2",
  };
  const names = visualScreenshotNames(run.id);
  const manifest = evidenceManifestForRun({
    run,
    names,
    url: "http://127.0.0.1:23001/",
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
      "artifacts/screens/session-cursor-full.png",
      "artifacts/screens/session-cursor-mobile-full.png",
    ],
  );
  assert.deepEqual(
    e2e.videos.map((entry) => entry.path),
    [
      "artifacts/videos/session-cursor-e2e.webm",
      "artifacts/videos/session-cursor-e2e.mp4",
    ],
  );
  assert.equal(e2e.trace, "artifacts/traces/session-cursor-e2e.zip");
  assert.deepEqual(e2e.navigations, ["http://127.0.0.1:23001/"]);
  assert.equal(e2e.proof.full_page, true);
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
