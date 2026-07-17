import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

/** Minimal issue record so execution resume/steer works when GET /issues/:id fails transiently. */
export function buildExecutionSessionFallbackIssue(
  projectSlug: string,
  identifier: string,
  execution?: AgentExecution,
): Issue {
  const trimmed = identifier.trim();
  return {
    id: trimmed,
    identifier: trimmed,
    projectSlug,
    status: "In Progress",
    title: trimmed,
    description: null,
    priority: null,
    position: 0,
    labels: [],
    blockedBy: [],
    assignee: null,
    creator: null,
    url: null,
    branchName: null,
    createdAt: "",
    updatedAt: "",
    attachments: [],
    agentKind: execution?.agentKind ?? null,
    model: execution?.model ?? null,
    effort: null,
  };
}
