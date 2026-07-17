import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";
import type { AgentKind, Issue } from "@/types/issue";
import type { ProjectSessionRow as SessionApiRow } from "@/types/project-session";

const KNOWN_EXECUTION_STATUSES: readonly AgentExecutionStatus[] = [
  "live",
  "idle",
  "waiting",
  "retrying",
  "error",
  "aborted",
  "paused",
  "saved",
];

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

/**
 * Fills gaps in the live AgentExecution map using autonomous `exec:` rows from
 * the project sessions API (disk-backed session logs when the orchestrator
 * snapshot omitted the run).
 */
export function mergeExecutionsFromSessionRows(
  executions: ReadonlyMap<string, AgentExecution>,
  sessions: readonly SessionApiRow[],
): ReadonlyMap<string, AgentExecution> {
  if (sessions.length === 0) return executions;

  let next: Map<string, AgentExecution> | null = null;

  for (const session of sessions) {
    if (!session.id.startsWith("exec:")) continue;
    const identifier = session.issueIdentifier?.trim();
    if (!identifier || executions.has(identifier) || next?.has(identifier)) continue;

    if (!next) next = new Map(executions);
    next.set(identifier, syntheticExecutionFromSessionRow(session, identifier));
  }

  return next ?? executions;
}

function syntheticExecutionFromSessionRow(
  session: SessionApiRow,
  identifier: string,
): AgentExecution {
  return {
    issueIdentifier: identifier,
    status: normalizeExecutionStatus(session.aggregateStatus),
    agentKind: session.agentKind,
    sessionId: null,
    executionSessionId: null,
    lastEvent: null,
    lastMessage: null,
    lastEventAt: session.updatedAt,
    turnCount: 0,
    runtimeSeconds: null,
    startedAt: session.updatedAt,
    retryAttempt: 0,
    error: null,
    goal: null,
    longRunning: false,
    longRunningKind: null,
    longRunningLabel: null,
    tokens: null,
  };
}

function normalizeExecutionStatus(status: string | null | undefined): AgentExecutionStatus {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (KNOWN_EXECUTION_STATUSES.includes(normalized as AgentExecutionStatus)) {
    return normalized as AgentExecutionStatus;
  }
  if (normalized === "active" || normalized === "running" || normalized === "in_progress") {
    return "live";
  }
  return "idle";
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
