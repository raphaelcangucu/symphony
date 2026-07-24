import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactSlug,
  issueRoute,
  selectRun,
  sessionRoute,
} from "../src/run-cell.mjs";

const manifest = {
  project_slug: "symphony-landing-benchmark",
  runs: [
    {
      id: "session-codex",
      path: "session",
      provider: "codex",
      thread_id: 41,
    },
    {
      id: "orchestrator-claude",
      path: "orchestrator",
      provider: "claude",
      issue_identifier: "SYM-6",
    },
  ],
};

test("selectRun resolves exactly one canonical matrix cell", () => {
  assert.equal(selectRun(manifest, "session-codex").thread_id, 41);
  assert.throws(() => selectRun(manifest, "missing"), /unknown benchmark run/);
});

test("artifactSlug accepts only safe canonical run identifiers", () => {
  assert.equal(artifactSlug("orchestrator-claude"), "orchestrator-claude");
  assert.throws(() => artifactSlug("../../escape"), /invalid benchmark run id/);
});

test("tracker routes target the real session and issue surfaces", () => {
  assert.equal(
    sessionRoute(manifest.project_slug, 41),
    "/tracker/projects/symphony-landing-benchmark/workspaces/41",
  );
  assert.equal(
    issueRoute(manifest.project_slug, "SYM-6"),
    "/tracker/projects/symphony-landing-benchmark/board/issues/SYM-6/sessions?surface=autonomous",
  );
});
