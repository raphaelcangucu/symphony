import assert from "node:assert/strict";
import test from "node:test";

import { validateSixTaskReport } from "./six-task-report.mjs";

const agents = [
  ["codex", "gpt-5.6-sol"],
  ["claude", "claude-opus-5"],
  ["cursor", "grok-4.5"],
];

function validReport() {
  return {
    schemaVersion: 1,
    projectSlug: "dev10x-six-task-e2e",
    tasks: ["session", "orchestrator"].flatMap((executionPath, pathIndex) =>
      agents.map(([agentKind, model], agentIndex) => ({
        identifier: `DEV-${pathIndex * 3 + agentIndex + 1}`,
        title: `Build the Dev10x site with ${model}`,
        executionPath,
        agentKind,
        requestedModel: model,
        requestedEffort: "high",
        resolvedModel: model,
        resolvedEffort: "high",
        status: "saved",
        log: {
          kind: executionPath,
          id: `${executionPath}-${agentIndex + 1}`,
        },
        evidence: [
          {
            kind: "screenshot",
            path: `.symphony/evidence/${executionPath}-${agentIndex + 1}.png`,
          },
        ],
      })),
    ),
  };
}

test("accepts six independent task executions with durable evidence", () => {
  const report = validReport();

  assert.deepEqual(validateSixTaskReport(report), report);
});

test("rejects a hidden comparison parent or child relationship", () => {
  const report = validReport();
  report.tasks[0].parentIdentifier = "DEV-0";

  assert.throws(() => validateSixTaskReport(report), /top-level task/i);
});

test("requires three session tasks and three orchestrator tasks", () => {
  const report = validReport();
  report.tasks[5].executionPath = "session";

  assert.throws(() => validateSixTaskReport(report), /three session and three orchestrator/i);
});

test("requires unique task IDs, provenance, log and evidence for every row", () => {
  const report = validReport();
  report.tasks[5].identifier = report.tasks[0].identifier;
  report.tasks[2].resolvedModel = null;
  report.tasks[3].log = null;
  report.tasks[4].evidence = [];

  assert.throws(() => validateSixTaskReport(report), /unique task identifiers/i);
});
