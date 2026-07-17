import type { TreeKeyboardRow } from "@/lib/sidebarTreeKeyboard";
import type {
  SidebarAggregateStatus,
  SidebarLoadState,
  SidebarNode,
  SidebarProjectNode,
  SidebarSessionKind,
  SidebarSessionNode,
  SidebarWorkspaceKind,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const SYNTHETIC_PREFIX = "::sidebar:";
const AGGREGATE_STATUSES = new Set<SidebarAggregateStatus>([
  "idle",
  "active",
  "attention",
  "error",
  "stale",
]);
const LOAD_STATES = new Set<SidebarLoadState>(["idle", "loading", "ready", "error", "stale"]);
const WORKSPACE_KINDS = new Set<SidebarWorkspaceKind>([
  "project",
  "issue",
  "standalone",
  "parallel",
  "orphan",
]);
const SESSION_KINDS = new Set<SidebarSessionKind>(["chat", "authoring", "execution"]);
const SESSION_STATUSES = new Set([
  "running",
  "waiting",
  "retrying",
  "idle",
  "active",
  "in_progress",
  "todo",
  "done",
  "closed",
  "error",
  "aborted",
]);
const AGENTS = new Set(["codex", "claude", "cursor", "opencode"]);

export type SidebarSyntheticKind =
  | "loading"
  | "error"
  | "stale"
  | "empty-project"
  | "unassigned"
  | "empty-workspace"
  | "more-workspaces"
  | "more-sessions";

export interface SidebarSyntheticNode {
  readonly kind: "synthetic";
  readonly syntheticKind: SidebarSyntheticKind;
  readonly id: string;
  readonly projectId: string;
  readonly workspaceId: string | null;
  readonly parentId: string;
}

export interface SidebarVisibleRow extends TreeKeyboardRow {
  readonly node: SidebarNode | SidebarSyntheticNode;
  readonly level: 1 | 2 | 3;
}

export function normalizeSidebarTree(value: unknown): readonly SidebarProjectNode[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  const projects: SidebarProjectNode[] = [];
  for (const candidate of value) {
    const project = normalizeProject(candidate, usedIds);
    if (project) projects.push(project);
  }
  return projects;
}

export function buildSidebarVisibleRows(
  projects: readonly SidebarProjectNode[],
  expandedProjectIds: ReadonlySet<string>,
  expandedWorkspaceIds: ReadonlySet<string>,
): readonly SidebarVisibleRow[] {
  const rows: SidebarVisibleRow[] = [];
  for (const project of projects) {
    const projectExpanded = expandedProjectIds.has(project.id);
    rows.push(row(project, null, 1, true, projectExpanded));
    if (!projectExpanded) continue;

    const branchKind = branchSyntheticKind(project);
    if (branchKind) rows.push(syntheticRow(branchKind, project.id, null, project.id, 2));

    for (const session of project.sessions) {
      rows.push(row(session, project.id, 2, false, false));
    }
    // Overflow stays collapsed behind "More" until revealedProjectIds lifts the limit.
    if (project.overflowSessions.length > 0 || project.nextCursor) {
      rows.push(syntheticRow("more-sessions", project.id, null, project.id, 2));
    }

    for (const workspace of project.workspaces) {
      const workspaceExpanded = expandedWorkspaceIds.has(workspace.id);
      rows.push(row(workspace, project.id, 2, true, workspaceExpanded));
      if (!workspaceExpanded) continue;
      for (const session of workspace.sessions) {
        rows.push(row(session, workspace.id, 3, false, false));
      }
      if (workspace.sessions.length === 0) {
        rows.push(syntheticRow("empty-workspace", project.id, workspace.id, workspace.id, 3));
      }
      if (workspace.overflowSessions.length > 0) {
        rows.push(syntheticRow("more-sessions", project.id, workspace.id, workspace.id, 3));
      }
    }
    if (project.overflowWorkspaces.length > 0) {
      rows.push(syntheticRow("more-workspaces", project.id, null, project.id, 2));
    }
    if (project.unassignedSessions.length > 0) {
      const unassigned = syntheticRow("unassigned", project.id, null, project.id, 2, true);
      rows.push(unassigned);
      for (const session of project.unassignedSessions) {
        rows.push(row(session, unassigned.id, 3, false, false));
      }
    }
  }
  return rows;
}

export function syntheticRowId(
  kind: SidebarSyntheticKind,
  projectId: string,
  workspaceId: string | null,
): string {
  return `${SYNTHETIC_PREFIX}${segment(kind)}${segment(projectId)}${segment(workspaceId ?? "")}`;
}

export function sidebarTreeIndent(level: 1 | 2 | 3): number {
  return (level - 1) * 12 + 2;
}

function row(
  node: SidebarNode,
  parentId: string | null,
  level: 1 | 2 | 3,
  hasChildren: boolean,
  expanded: boolean,
): SidebarVisibleRow {
  return { id: node.id, parentId, level, hasChildren, expanded, node };
}

function syntheticRow(
  syntheticKind: SidebarSyntheticKind,
  projectId: string,
  workspaceId: string | null,
  parentId: string,
  level: 2 | 3,
  hasChildren = false,
): SidebarVisibleRow {
  const node: SidebarSyntheticNode = {
    kind: "synthetic",
    syntheticKind,
    id: syntheticRowId(syntheticKind, projectId, workspaceId),
    projectId,
    workspaceId,
    parentId,
  };
  return { id: node.id, parentId, level, hasChildren, expanded: hasChildren, node };
}

function branchSyntheticKind(project: SidebarProjectNode): SidebarSyntheticKind | null {
  if (project.loadState === "idle" || project.loadState === "loading") return "loading";
  if (project.loadState === "error") return "error";
  if (project.loadState === "stale") return "stale";
  if (
    project.sessions.length === 0 &&
    project.workspaces.length === 0 &&
    project.unassignedSessions.length === 0
  ) {
    return "empty-project";
  }
  return null;
}

function normalizeProject(value: unknown, usedIds: Set<string>): SidebarProjectNode | null {
  if (!record(value) || value.kind !== "project") return null;
  const id = availableIdentity(value.id, usedIds);
  const title = nonblank(value.title);
  const href = routeHref(value.href);
  if (!id || !title || !href || !AGGREGATE_STATUSES.has(value.aggregateStatus as SidebarAggregateStatus)) {
    return null;
  }
  if (!LOAD_STATES.has(value.loadState as SidebarLoadState)) return null;
  if (
    !Array.isArray(value.workspaces) ||
    !Array.isArray(value.overflowWorkspaces) ||
    !Array.isArray(value.unassignedSessions) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.overflowSessions)
  ) {
    return null;
  }
  usedIds.add(id);
  const sessions = normalizeSessions(value.sessions, usedIds, null);
  const overflowSessions = normalizeSessions(value.overflowSessions, usedIds, null);
  const workspaces = normalizeWorkspaces(value.workspaces, usedIds);
  const overflowWorkspaces = normalizeWorkspaces(value.overflowWorkspaces, usedIds);
  const unassignedSessions = normalizeSessions(value.unassignedSessions, usedIds, null);
  return {
    ...(value as unknown as SidebarProjectNode),
    id,
    projectSlug: nonblank(value.projectSlug) ?? id,
    title,
    subtitle: stringValue(value.subtitle),
    href,
    aggregateStatus: value.aggregateStatus as SidebarAggregateStatus,
    updatedAt: timestamp(value.updatedAt),
    loadState: value.loadState as SidebarLoadState,
    error: nullableString(value.error),
    sessions,
    overflowSessions,
    nextCursor: nullableString(value.nextCursor),
    workspaces,
    overflowWorkspaces,
    unassignedSessions,
    archived: value.archived === true,
    pinned: value.pinned === true,
  };
}

function normalizeWorkspaces(value: unknown, usedIds: Set<string>): SidebarWorkspaceNode[] {
  if (!Array.isArray(value)) return [];
  const result: SidebarWorkspaceNode[] = [];
  for (const candidate of value) {
    if (!record(candidate) || candidate.kind !== "workspace") continue;
    const id = availableIdentity(candidate.id, usedIds);
    const title = nonblank(candidate.title);
    const href = routeHref(candidate.href);
    if (!id || !title || !href) continue;
    if (!WORKSPACE_KINDS.has(candidate.workspaceKind as SidebarWorkspaceKind)) continue;
    if (!AGGREGATE_STATUSES.has(candidate.aggregateStatus as SidebarAggregateStatus)) continue;
    if (!Array.isArray(candidate.sessions) || !Array.isArray(candidate.overflowSessions)) continue;
    usedIds.add(id);
    result.push({
      ...(candidate as unknown as SidebarWorkspaceNode),
      id,
      projectSlug: nonblank(candidate.projectSlug) ?? "",
      workspaceKind: candidate.workspaceKind as SidebarWorkspaceKind,
      title,
      subtitle: stringValue(candidate.subtitle),
      href,
      branchSummary: nullableString(candidate.branchSummary),
      aggregateStatus: candidate.aggregateStatus as SidebarAggregateStatus,
      updatedAt: timestamp(candidate.updatedAt),
      sessions: normalizeSessions(candidate.sessions, usedIds, id),
      overflowSessions: normalizeSessions(candidate.overflowSessions, usedIds, id),
      pinned: candidate.pinned === true,
    });
  }
  return result;
}

function normalizeSessions(
  value: unknown,
  usedIds: Set<string>,
  workspaceId: string | null,
): SidebarSessionNode[] {
  if (!Array.isArray(value)) return [];
  const result: SidebarSessionNode[] = [];
  for (const candidate of value) {
    if (!record(candidate) || candidate.kind !== "session") continue;
    const id = availableIdentity(candidate.id, usedIds);
    const title = nonblank(candidate.title);
    const href = routeHref(candidate.href);
    if (!id || !title || !href) continue;
    if (!SESSION_KINDS.has(candidate.sessionKind as SidebarSessionKind)) continue;
    if (!SESSION_STATUSES.has(candidate.statusKind as string)) continue;
    if (!AGGREGATE_STATUSES.has(candidate.aggregateStatus as SidebarAggregateStatus)) continue;
    if (candidate.agentKind !== null && !AGENTS.has(candidate.agentKind as string)) continue;
    usedIds.add(id);
    result.push({
      ...(candidate as unknown as SidebarSessionNode),
      id,
      projectSlug: nonblank(candidate.projectSlug) ?? "",
      workspaceId,
      sessionKind: candidate.sessionKind as SidebarSessionKind,
      title,
      subtitle: stringValue(candidate.subtitle),
      href,
      statusKind: candidate.statusKind as SidebarSessionNode["statusKind"],
      aggregateStatus: candidate.aggregateStatus as SidebarAggregateStatus,
      agentKind: candidate.agentKind as SidebarSessionNode["agentKind"],
      updatedAt: timestamp(candidate.updatedAt),
      unread: candidate.unread === true,
      needsReview: candidate.needsReview === true,
      archived: candidate.archived === true,
      pinned: candidate.pinned === true,
    });
  }
  return result;
}

function availableIdentity(value: unknown, usedIds: Set<string>): string | null {
  const id = nonblank(value);
  if (!id || id.startsWith(SYNTHETIC_PREFIX) || usedIds.has(id)) return null;
  return id;
}

function segment(value: string): string {
  return `${value.length}:${value}`;
}

function routeHref(value: unknown): string | null {
  const href = nonblank(value);
  if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
  if (/[\u0000-\u001f\\]/.test(href)) return null;
  return href;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return Number.isFinite(Date.parse(value)) ? value : "";
}

function nonblank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
