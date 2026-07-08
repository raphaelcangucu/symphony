import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";
import type { AgentKind, Issue } from "@/types/issue";

export const PROJECT_SESSION_BUCKETS = ["active", "waiting", "saved", "recent"] as const;

export type ProjectSessionBucket = (typeof PROJECT_SESSION_BUCKETS)[number];

export interface ProjectSessionRow {
  issueIdentifier: string;
  title: string;
  agentKind: AgentKind | null;
  status: AgentExecutionStatus;
  bucket: ProjectSessionBucket;
  lastEventAt: string | null;
  turnCount: number;
  runtimeSeconds: number | null;
  startedAt: string | null;
  goalObjective: string | null;
  execution: AgentExecution;
}

export type ProjectSessionGroups = Record<ProjectSessionBucket, ProjectSessionRow[]>;

export function emptyProjectSessionGroups(): ProjectSessionGroups {
  return {
    active: [],
    waiting: [],
    saved: [],
    recent: [],
  };
}

export function sessionBucketFor(status: AgentExecutionStatus): ProjectSessionBucket {
  switch (status) {
    case "live":
    case "retrying":
      return "active";
    case "waiting":
    case "idle":
      return "waiting";
    case "saved":
      return "saved";
    case "paused":
      return "waiting";
    case "error":
    case "aborted":
      return "recent";
  }
}

export function groupProjectSessions(
  executions: Iterable<AgentExecution>,
  issues: readonly Pick<Issue, "identifier" | "title">[],
): ProjectSessionGroups {
  const titles = new Map(issues.map((issue) => [issue.identifier, issue.title]));
  const groups = emptyProjectSessionGroups();

  for (const execution of executions) {
    const title = titles.get(execution.issueIdentifier);
    if (!title) continue;

    const bucket = sessionBucketFor(execution.status);
    groups[bucket].push({
      issueIdentifier: execution.issueIdentifier,
      title,
      agentKind: execution.agentKind,
      status: execution.status,
      bucket,
      lastEventAt: execution.lastEventAt,
      turnCount: execution.turnCount,
      runtimeSeconds: execution.runtimeSeconds,
      startedAt: execution.startedAt,
      goalObjective: execution.goal?.objective ?? null,
      execution,
    });
  }

  for (const bucket of PROJECT_SESSION_BUCKETS) {
    groups[bucket].sort((a, b) => timestampValue(b.lastEventAt) - timestampValue(a.lastEventAt));
  }

  return groups;
}

function timestampValue(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
