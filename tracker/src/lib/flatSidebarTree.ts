import {
  aggregateStatus,
  partitionVisibleNodes,
  SIDEBAR_DEFAULT_SESSION_LIMIT,
  sortSidebarNodes,
} from "@/lib/sidebarTree";
import { workspaceBasePath } from "@/lib/workspaceRoutes";
import type { ProjectSessionKind, ProjectSessionRow } from "@/types/project-session";
import type { RecentStatusKind } from "@/types/recents";
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
    title: nonBlank(row.title) ?? `Session ${id}`,
    subtitle: row.issueIdentifier ?? row.workspacePath ?? projectTitle,
    href: row.href,
    statusKind,
    aggregateStatus: statusToAggregate(row.aggregateStatus),
    agentKind: row.agentKind,
    updatedAt,
    threadId: parseThreadId(id),
    issueIdentifier: row.issueIdentifier,
    archived: row.archived,
    unread: unreadFromLastRead(id, updatedAt, options, true),
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
