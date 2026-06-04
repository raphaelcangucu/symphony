import type { WorkflowStatus } from "@/types/workflow-status";

export interface SplitWorkflowMarkdown {
  frontMatter: string;
  body: string;
}

/** Splits `---` / YAML front matter / `---` / body (Symphony WORKFLOW format). */
export function splitWorkflowMarkdown(content: string): SplitWorkflowMarkdown {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { frontMatter: "", body: content };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 0) {
    return { frontMatter: lines.slice(1).join("\n"), body: "" };
  }

  return {
    frontMatter: lines.slice(1, closingIndex).join("\n"),
    body: lines.slice(closingIndex + 1).join("\n").replace(/^\n/, ""),
  };
}

export function joinWorkflowMarkdown(frontMatter: string, body: string): string {
  const yaml = frontMatter.trim();
  const prompt = body.trimEnd();
  if (!yaml) return prompt;
  return `---\n${yaml}\n---\n\n${prompt}`;
}

export function buildDefaultWorkflowMarkdown(statuses: WorkflowStatus[]): string {
  const names = statuses.map((status) => status.name);
  const terminal = statuses.filter((status) => status.isTerminal).map((status) => status.name);
  const wait = statuses.filter((status) => status.category === "wait").map((status) => status.name);
  const active = statuses
    .filter((status) => !status.isTerminal && status.category !== "wait" && status.category !== "backlog")
    .map((status) => status.name);
  const field = names.length > 0 ? names : ["Todo", "In Progress", "Done"];

  const frontMatter = [
    "tracker:",
    `  field_states: [${field.map(yamlString).join(", ")}]`,
    `  active_states: [${(active.length > 0 ? active : field.slice(0, 2)).map(yamlString).join(", ")}]`,
    wait.length > 0 ? `  wait_states: [${wait.map(yamlString).join(", ")}]` : null,
    `  terminal_states: [${(terminal.length > 0 ? terminal : ["Done"]).map(yamlString).join(", ")}]`,
  ]
    .filter(Boolean)
    .join("\n");

  return joinWorkflowMarkdown(frontMatter, "You are working on issue `{{ issue.identifier }}` in this Symphony workspace.\n");
}

function yamlString(value: string): string {
  return value.includes(" ") || value.includes(":") ? JSON.stringify(value) : value;
}

export function initialWorkflowMarkdown(
  stored: string | null | undefined,
  statuses: WorkflowStatus[],
): string {
  const trimmed = stored?.trim();
  if (trimmed) return stored ?? "";
  return buildDefaultWorkflowMarkdown(statuses);
}
