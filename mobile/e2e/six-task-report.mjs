import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const executionPaths = ["session", "orchestrator"];
const agentKinds = ["codex", "claude", "cursor"];
const relationshipKeys = [
  "parent",
  "parentId",
  "parentIdentifier",
  "parent_id",
  "parent_identifier",
  "children",
  "childIds",
  "child_ids",
  "comparisonId",
  "comparison_id",
];

export function validateSixTaskReport(value) {
  assertRecord(value, "report");
  if (value.schemaVersion !== 1) throw new Error("Report schemaVersion must be 1");
  assertString(value.projectSlug, "projectSlug");
  if (!Array.isArray(value.tasks) || value.tasks.length !== 6) {
    throw new Error("Report must contain exactly six independent tasks");
  }

  for (const key of relationshipKeys) {
    if (key in value) throw new Error("Report must not contain a comparison parent");
  }

  const identifiers = value.tasks.map((task, index) => {
    assertRecord(task, `tasks[${index}]`);
    return assertString(task.identifier, `tasks[${index}].identifier`);
  });
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("Report must contain six unique task identifiers");
  }

  const pathCounts = new Map(executionPaths.map((path) => [path, 0]));
  for (const [index, task] of value.tasks.entries()) {
    const executionPath = assertEnum(
      task.executionPath,
      executionPaths,
      `tasks[${index}].executionPath`,
    );
    pathCounts.set(executionPath, pathCounts.get(executionPath) + 1);
  }
  if (pathCounts.get("session") !== 3 || pathCounts.get("orchestrator") !== 3) {
    throw new Error("Report must contain three session and three orchestrator tasks");
  }

  const cells = new Set();
  for (const [index, task] of value.tasks.entries()) {
    for (const key of relationshipKeys) {
      if (key in task) throw new Error(`tasks[${index}] must remain a top-level task`);
    }

    const executionPath = assertEnum(
      task.executionPath,
      executionPaths,
      `tasks[${index}].executionPath`,
    );
    const agentKind = assertEnum(task.agentKind, agentKinds, `tasks[${index}].agentKind`);
    const cell = `${executionPath}:${agentKind}`;
    if (cells.has(cell)) throw new Error(`Duplicate validation cell ${cell}`);
    cells.add(cell);

    assertString(task.title, `tasks[${index}].title`);
    assertString(task.requestedModel, `tasks[${index}].requestedModel`);
    assertString(task.requestedEffort, `tasks[${index}].requestedEffort`);
    assertString(task.resolvedModel, `tasks[${index}].resolvedModel`);
    assertString(task.resolvedEffort, `tasks[${index}].resolvedEffort`);
    assertString(task.status, `tasks[${index}].status`);
    assertRecord(task.log, `tasks[${index}].log`);
    assertEnum(task.log.kind, executionPaths, `tasks[${index}].log.kind`);
    if (task.log.kind !== executionPath) {
      throw new Error(`tasks[${index}].log.kind must match its execution path`);
    }
    assertString(String(task.log.id ?? ""), `tasks[${index}].log.id`);
    if (!Array.isArray(task.evidence) || task.evidence.length === 0) {
      throw new Error(`tasks[${index}] must include durable evidence`);
    }
    for (const [artifactIndex, artifact] of task.evidence.entries()) {
      assertRecord(artifact, `tasks[${index}].evidence[${artifactIndex}]`);
      assertString(artifact.kind, `tasks[${index}].evidence[${artifactIndex}].kind`);
      assertString(artifact.path, `tasks[${index}].evidence[${artifactIndex}].path`);
    }
  }

  for (const executionPath of executionPaths) {
    for (const agentKind of agentKinds) {
      if (!cells.has(`${executionPath}:${agentKind}`)) {
        throw new Error(`Missing validation cell ${executionPath}:${agentKind}`);
      }
    }
  }
  return value;
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a string`);
  return value;
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value;
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("usage: node e2e/six-task-report.mjs REPORT.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  validateSixTaskReport(report);
  process.stdout.write(`validated six independent tasks in ${reportPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
