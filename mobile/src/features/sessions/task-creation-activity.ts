export type TaskCreationActivity = {
  identifier: string | null;
  kind: "task" | "draft" | "subtask";
  parentIdentifier: string | null;
  title: string | null;
  unitType: string | null;
};

/**
 * All providers call the same Symphony authoring tools. The result message is
 * intentionally parsed defensively: older Host versions only persist that
 * stable, human-readable summary instead of the full tracker object.
 */
export function taskCreationActivity(toolName: string, output: string): TaskCreationActivity | null {
  if (toolName === "create_issue" || toolName === "create_draft_issue") {
    const match = output.match(/^Created (?:issue|draft) ([^:\s]+):\s*(.+)$/im);
    return {
      identifier: match?.[1] ?? null,
      kind: toolName === "create_draft_issue" ? "draft" : "task",
      parentIdentifier: null,
      title: match?.[2]?.trim() || null,
      unitType: null,
    };
  }
  if (toolName === "create_subtask") {
    const match = output.match(/^Created ([\w-]+) subtask ([^\s]+) under ([^\s(]+)/im);
    return {
      identifier: match?.[2] ?? null,
      kind: "subtask",
      parentIdentifier: match?.[3] ?? null,
      title: null,
      unitType: match?.[1] ?? null,
    };
  }
  return null;
}
