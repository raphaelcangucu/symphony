import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  renderVisualComparison,
  stopProcessGroup,
  visualPort,
  visualScreenshotNames,
} from "../src/capture-visuals.mjs";

test("visual captures reserve a deterministic isolated port per matrix cell", () => {
  assert.equal(visualPort(0), 23_000);
  assert.equal(visualPort(5), 23_005);
  assert.throws(() => visualPort(-1), /invalid visual capture index/);
});

test("visual captures use safe stable report names", () => {
  assert.deepEqual(visualScreenshotNames("orchestrator-claude"), {
    hero: "orchestrator-claude-hero.png",
    full: "orchestrator-claude-full.png",
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
  assert.match(report, /session-cursor/);
  assert.match(report, /skipped-contract/);
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
