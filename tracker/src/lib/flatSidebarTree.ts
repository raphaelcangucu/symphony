import {
  aggregateStatus,
  partitionVisibleNodes,
  SIDEBAR_DEFAULT_SESSION_LIMIT,
  sortSidebarNodes,
} from "@/lib/sidebarTree";
import { workspaceBasePath } from "@/lib/workspaceRoutes";
import type { ProjectSessionKind, ProjectSessionRow } from "@/types/project-session";
import type { RecentSession, RecentStatusKind } from "@/types/recents";
import type {
  SidebarAggregateStatus,
  SidebarFlatProjectBranchInput,
  SidebarLoadState,
  SidebarProjectNode,
  SidebarSessionKind,
  SidebarSessionNode,
  SidebarTreeBuildOptions,
  SidebarTreeFilters,
} from "@/types/sidebar";

const DEFAULT_TREE_FILTERS: SidebarTreeFilters = {
  statuses: [],
  agents: [],
  showArchived: true,
  activityOnly: false,
};

const ACTIVITY_STATUSES = new Set<SidebarAggregateStatus>(["active", "attention", "error"]);
const ERROR_STATUSES = new Set(["error", "failed", "crashed"]);
const ATTENTION_STATUSES = new Set(["waiting", "retrying", "aborted", "paused", "review"]);
const ACTIVE_STATUSES = new Set(["live", "running", "active", "in_progress"]);

/**
 * Merges live recents chat threads into the project-sessions list.
 *
 * project_sessions is loaded once on expand and can lag behind creates; recents
 * updates via PubSub. This upserts missing threads and overlays fresher titles
 * so the sidebar matches open tabs.
 */
export function mergeSessionsFromRecents(
  sessions: readonly ProjectSessionRow[],
  recents: readonly RecentSession[],
  projectSlug: string,
): readonly ProjectSessionRow[] {
  const slug = projectSlug.trim();
  if (!slug || recents.length === 0) return sessions;

  const byId = new Map(sessions.map((session) => [session.id, session]));
  let changed = false;

  for (const recent of recents) {
    if (recent.projectSlug !== slug) continue;
    if (recent.kind !== "chat" || recent.threadId == null) continue;

    const id = `thread:${recent.threadId}`;
    const title = recent.title.trim();
    const existing = byId.get(id);

    if (!existing) {
      byId.set(id, recentChatToSessionRow(recent));
      changed = true;
      continue;
    }

    if (title && existing.title.trim() !== title) {
      byId.set(id, {
        ...existing,
        title,
        updatedAt: recent.updatedAt || existing.updatedAt,
      });
      changed = true;
    }
  }

  return changed ? [...byId.values()] : sessions;
}

/** @deprecated Prefer mergeSessionsFromRecents — kept for existing call sites/tests. */
export function overlaySessionTitlesFromRecents(
  sessions: readonly ProjectSessionRow[],
  recents: readonly RecentSession[],
): readonly ProjectSessionRow[] {
  if (sessions.length === 0) return sessions;
  const projectSlug = recents.find((recent) => recent.projectSlug)?.projectSlug;
  if (!projectSlug) {
    return mergeSessionsFromRecents(sessions, recents, "");
  }
  return mergeSessionsFromRecents(sessions, recents, projectSlug);
}

function recentChatToSessionRow(recent: RecentSession): ProjectSessionRow {
  const threadId = recent.threadId;
  if (threadId == null) {
    throw new Error("recentChatToSessionRow requires threadId");
  }
  const projectSlug = recent.projectSlug?.trim() || "unknown";
  return {
    id: `thread:${threadId}`,
    title: recent.title.trim(),
    kind: sessionKindFromRecentScope(recent.scope),
    href: `/projects/${encodeURIComponent(projectSlug)}/workspaces/${threadId}`,
    updatedAt: recent.updatedAt,
    aggregateStatus: recent.statusKind,
    agentKind: recent.agentKind,
    issueIdentifier: recent.identifier,
    workspacePath: null,
    workspaceId: null,
    pinned: false,
    archived: recent.status === "archived",
  };
}

function sessionKindFromRecentScope(scope: RecentSession["scope"]): ProjectSessionKind {
  switch (scope) {
    case "issue":
      return "authoring";
    case "issue_session":
    case "issue_execution":
      // Matches SymphonyElixir.Tracker.ProjectSessions.thread_kind/1.
      return "execution";
    case "project_session":
    case "project_explore":
      return "workspace_session";
    default:
      return "chat";
  }
}

export function buildFlatSidebarProject(
  input: SidebarFlatProjectBranchInput,
): SidebarProjectNode {
  const projectSlug = input.projectSlug.trim();
  const projectTitle = input.projectTitle.trim();
  const filters = normalizeFilters(input.options.filters);
  const sessionLimit = input.options.sessionLimit ?? SIDEBAR_DEFAULT_SESSION_LIMIT;
  const filteredSessions = input.sessions.filter((session) =>
    sessionMatchesFilters(session, filters),
  );
  const sessionNodes = filteredSessions.map((session) =>
    sessionNodeFromRow(session, projectSlug, projectTitle, input.options),
  );
  const sortedSessions = sortSidebarNodes(sessionNodes, input.options.sortMode);
  const partition = partitionVisibleNodes(sortedSessions, sessionLimit);
  const branchStatus = loadStateStatus(input.loadState, input.error);
  const projectAggregateStatus = aggregateStatus([
    branchStatus,
    ...sortedSessions.map((session) => session.aggregateStatus),
  ]);
  const updatedAt = newestTimestamp(sortedSessions.map((session) => session.updatedAt));

  return {
    kind: "project",
    id: projectSlug,
    projectSlug,
    title: projectTitle,
    subtitle: `${sortedSessions.length} session${sortedSessions.length === 1 ? "" : "s"}`,
    href: workspaceBasePath(projectSlug, "board"),
    archived: input.archived,
    aggregateStatus: projectAggregateStatus,
    updatedAt,
    loadState: input.loadState,
    error: input.error,
    sessions: partition.visible,
    overflowSessions: partition.overflow,
    nextCursor: input.nextCursor,
    workspaces: [],
    overflowWorkspaces: [],
    unassignedSessions: [],
    pinned: input.options.pinnedProjectIds.has(projectSlug),
  };
}

function sessionNodeFromRow(
  row: ProjectSessionRow,
  projectSlug: string,
  projectTitle: string,
  options: SidebarTreeBuildOptions,
): SidebarSessionNode {
  const updatedAt = validTimestampString(row.updatedAt);
  const statusKind = normalizeRecentStatus(row.aggregateStatus);
  const id = row.id;

  return {
    kind: "session",
    id,
    projectSlug,
    workspaceId: row.workspaceId,
    sessionKind: sessionKindFromRow(row.kind),
    title: nonBlank(row.title) ?? sessionFallbackTitle(parseThreadId(id)),
    subtitle: row.issueIdentifier ?? row.workspacePath ?? projectTitle,
    href: row.href,
    statusKind,
    aggregateStatus: statusToAggregate(row.aggregateStatus),
    agentKind: row.agentKind,
    updatedAt,
    threadId: parseThreadId(id),
    issueIdentifier: row.issueIdentifier,
    archived: row.archived,
    unread: unreadFromLastRead(id, updatedAt, options, statusKind !== "idle" && statusKind !== "done" && statusKind !== "closed"),
    needsReview: false,
    labels: null,
    issueLabelNames: null,
    pinned: row.pinned || options.pinnedSessionIds.has(id),
  };
}

function sessionKindFromRow(kind: ProjectSessionKind): SidebarSessionKind {
  switch (kind) {
    case "execution":
      return "execution";
    case "authoring":
    case "issue":
      return "authoring";
    case "chat":
    case "workspace_session":
    default:
      return "chat";
  }
}

function sessionMatchesFilters(
  session: ProjectSessionRow,
  filters: SidebarTreeFilters,
): boolean {
  if (!filters.showArchived && session.archived) return false;
  const aggregate = statusToAggregate(session.aggregateStatus);
  if (filters.activityOnly && !ACTIVITY_STATUSES.has(aggregate)) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(aggregate)) return false;
  if (filters.agents.length > 0) {
    const agent = session.agentKind;
    if (agent == null || !filters.agents.includes(agent)) return false;
  }
  return true;
}

function normalizeFilters(
  filters: Partial<SidebarTreeFilters> | undefined,
): SidebarTreeFilters {
  return {
    statuses: [...(filters?.statuses ?? DEFAULT_TREE_FILTERS.statuses)],
    agents: [...(filters?.agents ?? DEFAULT_TREE_FILTERS.agents)],
    showArchived: filters?.showArchived ?? DEFAULT_TREE_FILTERS.showArchived,
    activityOnly: filters?.activityOnly ?? DEFAULT_TREE_FILTERS.activityOnly,
  };
}

function parseThreadId(id: string): number | null {
  if (!id.startsWith("thread:")) return null;
  const parsed = Number.parseInt(id.slice("thread:".length), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sessionFallbackTitle(threadId: number | null): string {
  return threadId === null ? "Session" : `Session ${threadId}`;
}

function statusToAggregate(status: string | null | undefined): SidebarAggregateStatus {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (ERROR_STATUSES.has(normalized)) return "error";
  if (ATTENTION_STATUSES.has(normalized)) return "attention";
  if (ACTIVE_STATUSES.has(normalized)) return "active";
  return "idle";
}

function normalizeRecentStatus(status: string | null | undefined): RecentStatusKind {
  const normalized = status?.trim().toLowerCase() ?? "";
  switch (normalized) {
    case "running":
    case "live":
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
      return normalized === "live" ? "running" : normalized;
    default:
      return "idle";
  }
}

function unreadFromLastRead(
  id: string,
  updatedAt: string,
  options: SidebarTreeBuildOptions,
  unreadWhenMissing: boolean,
): boolean {
  const lastReadLookup = options.lastReadAtBySession;
  const lastReadAt =
    lastReadLookup instanceof Map
      ? lastReadLookup.get(id)
      : lastReadLookup[id as keyof typeof lastReadLookup];
  if (!lastReadAt) return unreadWhenMissing;
  const lastReadTimestamp = timestampValue(lastReadAt);
  if (lastReadTimestamp === Number.NEGATIVE_INFINITY) return unreadWhenMissing;
  return timestampValue(updatedAt) > lastReadTimestamp;
}

function loadStateStatus(
  loadState: SidebarLoadState,
  error: string | null,
): SidebarAggregateStatus {
  if (error || loadState === "error") return "error";
  if (loadState === "stale") return "stale";
  return "idle";
}

function newestTimestamp(values: readonly string[]): string {
  let newest = "";
  let newestValue = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const parsed = timestampValue(value);
    if (parsed > newestValue) {
      newest = value;
      newestValue = parsed;
    }
  }
  return newest;
}

function validTimestampString(value: string | null | undefined): string {
  return timestampValue(value) !== Number.NEGATIVE_INFINITY && value ? value : "";
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NEGATIVE_INFINITY;
}

function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
