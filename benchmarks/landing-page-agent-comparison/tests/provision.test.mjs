import assert from "node:assert/strict";
import test from "node:test";

import { RUN_MATRIX } from "../src/contract.mjs";
import {
  buildRunRecords,
  projectPayload,
  workflowMarkdown,
} from "../src/provision.mjs";

test("workspace project payload configures preview, evidence and local clone", () => {
  const payload = projectPayload({
    seedBarePath: "/tmp/landing-seed.git",
    seedWorkingPath: "/tmp/landing-seed",
    workspaceRoot: "/tmp/landing-workspaces",
  });

  assert.equal(payload.slug, "symphony-landing-benchmark");
  assert.equal(payload.repositories[0].clone_url, "/tmp/landing-seed.git");
  assert.equal(payload.repositories[0].local_path, "/tmp/landing-seed");
  assert.equal(payload.repositories[0].workspace_path, "site");
  assert.match(payload.setup.workflow_markdown, /dev_server:\n  enabled: true/);
  assert.match(payload.setup.workflow_markdown, /dispatch_states:\n    - In Progress/);
  assert.match(payload.setup.workflow_markdown, /test:e2e/);
});

test("workflow prompt injects the issue description without provider branches", () => {
  const markdown = workflowMarkdown("/tmp/landing-workspaces");

  assert.match(markdown, /Execute exatamente a tarefa descrita abaixo/);
  assert.match(markdown, /\{\{ issue\.description \}\}/);
  assert.doesNotMatch(markdown, /if.*codex|if.*claude|if.*cursor/i);
});

test("all six run records carry the same prompt hash", () => {
  const prompt = "identical prompt\n";
  const records = buildRunRecords(prompt);

  assert.equal(records.length, RUN_MATRIX.length);
  assert.equal(new Set(records.map((run) => run.prompt_sha256)).size, 1);
  assert.deepEqual(records.map((run) => run.id), RUN_MATRIX.map((run) => run.id));
});
