import { listProjectSessions, type ListProjectSessionsInput } from "@/services/projectSessions";
import type { ProjectSessionKind, ProjectSessionRow, ProjectSessionsPage } from "@/types/project-session";
import type { RecentKind, RecentScope, RecentSession, RecentStatusKind } from "@/types/recents";

export const DEFAULT_PROJECT_SESSIONS_LIMIT = 20;

const inFlight = new Map<string, Promise<ProjectSessionsPage>>();

function cacheKey(input: ListProjectSessionsInput): string {
  const slug = input.projectSlug.trim();
  const limit = input.limit ?? DEFAULT_PROJECT_SESSIONS_LIMIT;
  const cursor = input.cursor?.trim() ?? "";
  const includeArchived = input.includeArchived ?? false;
  return `${slug}|${limit}|${cursor}|${includeArchived}`;
}

export function resetProjectSessionsCacheForTests(): void {
  inFlight.clear();
}

export async function fetchProjectSessions(input: ListProjectSessionsInput): Promise<ProjectSessionsPage> {
  const key = cacheKey(input);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = listProjectSessions(input).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

function parseThreadId(id: string): number | null {
  if (!id.startsWith("thread:")) return null;
  const parsed = Number.parseInt(id.slice("thread:".length), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function recentKindFromSessionKind(kind: ProjectSessionKind): RecentKind {
  return kind === "execution" ? "codex" : "chat";
}

function recentScopeFromSessionKind(kind: ProjectSessionKind): RecentScope {
  switch (kind) {
    case "authoring":
    case "issue":
      return "issue";
    case "execution":
      return "issue_session";
    case "workspace_session":
      return "project_session";
    default:
      return "project";
  }
}

function normalizeRecentStatus(status: string | null | undefined): RecentStatusKind {
  const normalized = status?.trim().toLowerCase() ?? "";
  switch (normalized) {
    case "running":
    case "waiting":
    case "retrying":
    case "idle":
    case "active":
    case "closed":
    case "error":
    case "aborted":
    case "done":
    case "in_progress":
    case "todo":
      return normalized;
    default:
      return "idle";
  }
}

export function projectSessionRowToRecent(
  row: ProjectSessionRow,
  projectSlug: string,
  projectName: string | null = null,
): RecentSession {
  return {
    id: row.id,
    kind: recentKindFromSessionKind(row.kind),
    scope: recentScopeFromSessionKind(row.kind),
    agentKind: row.agentKind,
    projectSlug,
    projectName,
    title: row.title,
    identifier: row.issueIdentifier,
    threadId: parseThreadId(row.id),
    status: row.aggregateStatus ?? "",
    statusKind: normalizeRecentStatus(row.aggregateStatus),
    preview: null,
    updatedAt: row.updatedAt,
  };
}

export function projectSessionsToRecents(
  page: ProjectSessionsPage,
  projectSlug: string,
  projectName: string | null = null,
): RecentSession[] {
  return page.sessions.map((row) => projectSessionRowToRecent(row, projectSlug, projectName));
}
