import assert from "node:assert/strict";
import test from "node:test";

import { RUN_MATRIX, workflowPromptTemplate } from "../src/contract.mjs";
import {
  buildRunRecords,
  devEnvironmentSteps,
  issueTitle,
  projectPayload,
  provisionSessions,
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
  assert.match(payload.setup.workflow_markdown, /max_turns: 30/);
  assert.match(payload.setup.workflow_markdown, /required: true/);
});

test("workflow prompt injects the issue description without provider branches", () => {
  const markdown = workflowMarkdown("/tmp/landing-workspaces");

  assert.match(markdown, /\{\{ issue\.description \}\}/);
  assert.doesNotMatch(markdown, /if.*codex|if.*claude|if.*cursor/i);
  assert.equal(workflowPromptTemplate(markdown), "{{ issue.description }}");
  assert.equal(markdown.endsWith("{{ issue.description }}"), true);
  assert.equal(markdown.endsWith("{{ issue.description }}\n"), false);
});

test("all six run records carry the same prompt hash", () => {
  const prompt = "identical prompt\n";
  const records = buildRunRecords(prompt);

  assert.equal(records.length, RUN_MATRIX.length);
  assert.equal(new Set(records.map((run) => run.prompt_sha256)).size, 1);
  assert.deepEqual(new Set(records.map((run) => run.execution_mode)), new Set(["yolo"]));
  assert.deepEqual(records.map((run) => run.id), RUN_MATRIX.map((run) => run.id));
});

test("preview uses one explicit canonical serve step", () => {
  const steps = devEnvironmentSteps();

  assert.equal(steps.length, 1);
  assert.equal(steps[0].role, "serve");
  assert.equal(steps[0].working_dir, "site");
  assert.equal(
    steps[0].command,
    `sh -c 'npm run dev -- --host 0.0.0.0 --port "$PORT"'`,
  );
  assert.equal(steps[0].run_spec, undefined);
});

test("direct sessions use the canonical atomic workspace provisioner", async () => {
  const apiCalls = [];
  const records = [
    {
      id: "session-claude",
      path: "session",
      provider: "claude",
      issue_identifier: "SYM-3",
      execution_mode: "yolo",
    },
    {
      id: "orchestrator-claude",
      path: "orchestrator",
      provider: "claude",
      issue_identifier: "SYM-6",
      execution_mode: "yolo",
    },
  ];
  const api = {
    async request(path, options) {
      apiCalls.push([path, options]);

      if (path === "/assistant/threads") {
        assert.equal(options.body.issue_identifier, "SYM-3");
        return {
          id: 33,
          workspace_path: "/tmp/landing-workspaces/SYM-3__p1",
        };
      }

      assert.equal(path, "/assistant/threads/33/workspace/provision");
      return {
        status: "ready",
        workspace_path: "/tmp/landing-workspaces/SYM-3__p1",
      };
    },
  };

  await provisionSessions(api, records);

  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[1][1].method, "POST");
  assert.equal(records[0].thread_id, 33);
  assert.equal(
    records[0].workspace_path,
    "/tmp/landing-workspaces/SYM-3__p1",
  );
});

test("issue titles identify the execution path and provider", () => {
  assert.equal(
    issueTitle({ path: "session", provider: "cursor" }),
    "Landing benchmark · session · cursor",
  );
  assert.equal(
    issueTitle({ path: "orchestrator", provider: "claude" }),
    "Landing benchmark · orchestrator · claude",
  );
});
