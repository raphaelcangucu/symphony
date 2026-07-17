import { recentSessionPath } from "@/components/layout/recentSessionPath";
import { buildWorkspaceCards, type WorkspaceCard } from "@/lib/workspaceCards";
import {
  projectAuthoringSessionPath,
  projectSessionPath,
  projectSessionsPath,
  workspaceBasePath,
} from "@/lib/workspaceRoutes";
import type { AgentExecution, AgentExecutionStatus } from "@/types/agent-execution";
import type { AssistantThread } from "@/types/assistant-thread";
import type { RecentSession, RecentStatusKind } from "@/types/recents";
import type {
  SidebarAggregateStatus,
  SidebarFilterAgent,
  SidebarGroupMode,
  SidebarLoadState,
  SidebarProjectBranchInput,
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarSortMode,
  SidebarSortableNode,
  SidebarTreeBuildOptions,
  SidebarTreeFilters,
  SidebarVisiblePartition,
  SidebarWorkspaceKind,
  SidebarWorkspaceNode,
} from "@/types/sidebar";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

export const SIDEBAR_DEFAULT_WORKSPACE_LIMIT = 8;
export const SIDEBAR_DEFAULT_SESSION_LIMIT = 6;

const DEFAULT_TREE_FILTERS: SidebarTreeFilters = {
  statuses: [],
  agents: [],
  showArchived: true,
  activityOnly: false,
};

const ACTIVITY_STATUSES = new Set<SidebarAggregateStatus>(["active", "attention", "error"]);
const VALID_GROUP_MODES = new Set<SidebarGroupMode>(["none", "workspaceKind", "status"]);
const VALID_FILTER_AGENTS = new Set<SidebarFilterAgent>([
  "codex",
  "claude",
  "cursor",
  "opencode",
]);
const WORKSPACE_KIND_ORDER: Readonly<Record<SidebarWorkspaceKind, number>> = {
  project: 0,
  issue: 1,
  standalone: 2,
  parallel: 3,
  orphan: 4,
};

const STATUS_PRECEDENCE: Readonly<Record<SidebarAggregateStatus, number>> = {
  idle: 0,
  stale: 1,
  active: 2,
  attention: 3,
  error: 4,
};

const ERROR_STATUSES = new Set(["error", "failed", "crashed"]);
const ATTENTION_STATUSES = new Set(["waiting", "retrying", "aborted", "paused", "review"]);
const ACTIVE_STATUSES = new Set(["live", "running", "active", "in_progress"]);

export type NormalizedSidebarTreeBuildOptions = Omit<
  SidebarTreeBuildOptions,
  "workspaceLimit" | "sessionLimit" | "groupMode" | "filters"
> & {
  workspaceLimit: number;
  sessionLimit: number;
  groupMode: SidebarGroupMode;
  filters: SidebarTreeFilters;
};

export type NormalizedSidebarProjectBranchInput = Omit<
  SidebarProjectBranchInput,
  "executions" | "options"
> & {
  executions: readonly AgentExecution[];
  options: NormalizedSidebarTreeBuildOptions;
};

type MutableSidebarWorkspaceNode = Omit<
  SidebarWorkspaceNode,
  "inventory" | "sessions" | "overflowSessions"
> & {
  inventory: WorkspaceInventoryEntry | null;
  sessions: SidebarSessionNode[];
  overflowSessions: SidebarSessionNode[];
};

interface PreparedProjectSources {
  projectIssues: SidebarProjectBranchInput["issues"];
  projectSessions: RecentSession[];
  projectThreads: AssistantThread[];
  threadById: ReadonlyMap<number, AssistantThread>;
  authoringRecentByIssue: ReadonlyMap<string, RecentSession>;
}

export function buildSidebarProjectTree(input: SidebarProjectBranchInput): SidebarProjectNode {
  const normalized = normalizeSidebarProjectBranchInput(input);
  const {
    projectIssues,
    projectSessions,
    projectThreads,
    threadById,
    authoringRecentByIssue,
  } = prepareProjectSources(normalized);
  const cards = buildWorkspaceCards({
    executions: normalized.executions,
    issues: projectIssues,
    relatedSessions: projectSessions,
    inventory: normalized.inventory,
  });
  const allCards = [
    ...cards.activeCards,
    ...cards.projectCards,
    ...cards.waitingCards,
    ...cards.orphanCards,
  ];
  const issueUpdatedAt = new Map(
    projectIssues.map((issue) => [issue.identifier, validTimestampString(issue.updatedAt)]),
  );
  const workspaceEntries = allCards.map((card) => ({
    card,
    node: workspaceFromCard(card, normalized, issueUpdatedAt),
  }));
  const unassignedSessions = attachProjectSessions({
    workspaceEntries,
    freeChatSessions: cards.chatSessions,
    projectThreads,
    threadById,
    authoringRecentByIssue,
    input: normalized,
  });

  const completedWorkspaces = workspaceEntries.map(({ node }) =>
    completeWorkspace(node, normalized.options),
  );
  const filtered = applySidebarTreeFilters(
    completedWorkspaces,
    unassignedSessions,
    normalized.options.filters,
  );
  const sortedWorkspaces = sortSidebarNodes(filtered.workspaces, normalized.options.sortMode);
  const groupedWorkspaces = groupWorkspaces(sortedWorkspaces, normalized.options.groupMode);
  const workspacePartition = partitionVisibleNodes(
    groupedWorkspaces,
    normalized.options.workspaceLimit,
  );
  const sortedUnassigned = sortSidebarNodes(filtered.unassignedSessions, normalized.options.sortMode);
  const branchStatus = loadStateStatus(normalized.loadState, normalized.error);
  const projectAggregateStatus = aggregateStatus([
    branchStatus,
    ...filtered.workspaces.map((workspace) => workspace.aggregateStatus),
    ...sortedUnassigned.map((session) => session.aggregateStatus),
  ]);
  const updatedAt = newestTimestamp([
    ...filtered.workspaces.map((workspace) => workspace.updatedAt),
    ...sortedUnassigned.map((session) => session.updatedAt),
  ]);

  return {
    kind: "project",
    id: normalized.projectSlug,
    projectSlug: normalized.projectSlug,
    title: normalized.projectTitle,
    subtitle: `${filtered.workspaces.length} workspace${filtered.workspaces.length === 1 ? "" : "s"}`,
    href: workspaceBasePath(normalized.projectSlug, "board"),
    archived: normalized.archived,
    aggregateStatus: projectAggregateStatus,
    updatedAt,
    loadState: normalized.loadState,
    error: normalized.error,
    sessions: [],
    overflowSessions: [],
    nextCursor: null,
    workspaces: workspacePartition.visible,
    overflowWorkspaces: workspacePartition.overflow,
    unassignedSessions: sortedUnassigned,
    pinned: normalized.options.pinnedProjectIds.has(normalized.projectSlug),
  };
}

export function applySidebarTreeFilters(
  workspaces: readonly SidebarWorkspaceNode[],
  unassignedSessions: readonly SidebarSessionNode[],
  filters: SidebarTreeFilters,
): {
  workspaces: SidebarWorkspaceNode[];
  unassignedSessions: SidebarSessionNode[];
} {
  const nextWorkspaces: SidebarWorkspaceNode[] = [];
  for (const workspace of workspaces) {
    const sessions = workspace.sessions.filter((session) => sessionMatchesFilters(session, filters));
    const overflowSessions = workspace.overflowSessions.filter((session) =>
      sessionMatchesFilters(session, filters),
    );
    if (!shouldKeepWorkspace(workspace, sessions, overflowSessions, filters)) {
      continue;
    }
    const allSessions = [...sessions, ...overflowSessions];
    nextWorkspaces.push({
      ...workspace,
      sessions,
      overflowSessions,
      aggregateStatus: aggregateStatus([
        inventoryStatus(workspace.inventory),
        ...allSessions.map((session) => session.aggregateStatus),
      ]),
      updatedAt: newestTimestamp([
        workspace.updatedAt,
        ...allSessions.map((session) => session.updatedAt),
      ]),
    });
  }
  return {
    workspaces: nextWorkspaces,
    unassignedSessions: unassignedSessions.filter((session) =>
      sessionMatchesFilters(session, filters),
    ),
  };
}

function shouldKeepWorkspace(
  workspace: SidebarWorkspaceNode,
  sessions: readonly SidebarSessionNode[],
  overflowSessions: readonly SidebarSessionNode[],
  filters: SidebarTreeFilters,
): boolean {
  if (sessions.length + overflowSessions.length > 0) return true;
  if (filters.agents.length > 0) return false;
  if (filters.statuses.length === 0 && !filters.activityOnly) return true;
  return workspaceMatchesFilters(workspace, filters);
}

export function groupWorkspaces(
  workspaces: readonly SidebarWorkspaceNode[],
  groupMode: SidebarGroupMode,
): SidebarWorkspaceNode[] {
  if (groupMode === "none") return [...workspaces];
  return [...workspaces].sort((left, right) => {
    const groupDifference =
      groupMode === "workspaceKind"
        ? WORKSPACE_KIND_ORDER[left.workspaceKind] - WORKSPACE_KIND_ORDER[right.workspaceKind]
        : STATUS_PRECEDENCE[right.aggregateStatus] - STATUS_PRECEDENCE[left.aggregateStatus];
    if (groupDifference !== 0) return groupDifference;
    return 0;
  });
}

function sessionMatchesFilters(
  session: SidebarSessionNode,
  filters: SidebarTreeFilters,
): boolean {
  if (!filters.showArchived && session.archived) return false;
  if (filters.activityOnly && !ACTIVITY_STATUSES.has(session.aggregateStatus)) return false;
  if (
    filters.statuses.length > 0 &&
    !filters.statuses.includes(session.aggregateStatus)
  ) {
    return false;
  }
  if (filters.agents.length > 0) {
    const agent = session.agentKind;
    if (agent == null || !filters.agents.includes(agent as SidebarFilterAgent)) {
      return false;
    }
  }
  return true;
}

function workspaceMatchesFilters(
  workspace: SidebarWorkspaceNode,
  filters: SidebarTreeFilters,
): boolean {
  if (filters.activityOnly && !ACTIVITY_STATUSES.has(workspace.aggregateStatus)) return false;
  if (
    filters.statuses.length > 0 &&
    !filters.statuses.includes(workspace.aggregateStatus)
  ) {
    return false;
  }
  return true;
}

function attachProjectSessions({
  workspaceEntries,
  freeChatSessions,
  projectThreads,
  threadById,
  authoringRecentByIssue,
  input,
}: {
  workspaceEntries: Array<{ card: WorkspaceCard; node: MutableSidebarWorkspaceNode }>;
  freeChatSessions: readonly RecentSession[];
  projectThreads: readonly AssistantThread[];
  threadById: ReadonlyMap<number, AssistantThread>;
  authoringRecentByIssue: ReadonlyMap<string, RecentSession>;
  input: NormalizedSidebarProjectBranchInput;
}): SidebarSessionNode[] {
  const workspaceByPath = new Map<string, MutableSidebarWorkspaceNode>();
  for (const { node } of workspaceEntries) {
    if (node.inventory) workspaceByPath.set(node.inventory.path, node);
  }
  const seenThreadIds = new Set<number>();
  const unassignedSessions: SidebarSessionNode[] = [];

  for (const { card, node } of workspaceEntries) {
    const cardSessions = sessionNodesFromCard(
      card,
      node.id,
      input,
      threadById,
      authoringRecentByIssue,
      projectThreads,
    );
    for (const { session, sourceThread } of cardSessions) {
      if (sourceThread) seenThreadIds.add(sourceThread.id);
      attachSession(
        session,
        sourceThread,
        node,
        workspaceByPath,
        unassignedSessions,
      );
    }
  }

  for (const recent of freeChatSessions) {
    const sourceThread = recent.threadId == null ? undefined : threadById.get(recent.threadId);
    if (sourceThread) seenThreadIds.add(sourceThread.id);
    attachSession(
      chatSessionNode(recent, null, input, sourceThread),
      sourceThread,
      null,
      workspaceByPath,
      unassignedSessions,
    );
  }

  for (const sourceThread of projectThreads) {
    if (seenThreadIds.has(sourceThread.id)) continue;
    attachSession(
      threadSessionNode(sourceThread, null, input),
      sourceThread,
      null,
      workspaceByPath,
      unassignedSessions,
    );
  }
  return unassignedSessions;
}

function attachSession(
  session: SidebarSessionNode,
  sourceThread: AssistantThread | undefined,
  defaultWorkspace: MutableSidebarWorkspaceNode | null,
  workspaceByPath: ReadonlyMap<string, MutableSidebarWorkspaceNode>,
  unassignedSessions: SidebarSessionNode[],
): void {
  const exactWorkspace = sourceThread?.workspacePath
    ? workspaceByPath.get(sourceThread.workspacePath)
    : undefined;
  if (sourceThread?.workspacePath && !exactWorkspace) {
    unassignedSessions.push({ ...session, workspaceId: null });
    return;
  }
  const target = exactWorkspace ?? defaultWorkspace;
  if (!target) {
    unassignedSessions.push({ ...session, workspaceId: null });
    return;
  }
  target.sessions.push({ ...session, workspaceId: target.id });
}

export function aggregateStatus(
  statuses: readonly SidebarAggregateStatus[],
): SidebarAggregateStatus {
  let aggregate: SidebarAggregateStatus = "idle";
  for (const status of statuses) {
    if (!(status in STATUS_PRECEDENCE)) continue;
    if (STATUS_PRECEDENCE[status] > STATUS_PRECEDENCE[aggregate]) aggregate = status;
  }
  return aggregate;
}

export function compareSidebarNodes(
  left: SidebarSortableNode,
  right: SidebarSortableNode,
): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;

  const leftTimestamp = timestampValue(left.updatedAt);
  const rightTimestamp = timestampValue(right.updatedAt);
  if (leftTimestamp !== rightTimestamp) return rightTimestamp > leftTimestamp ? 1 : -1;

  const statusDifference =
    STATUS_PRECEDENCE[right.aggregateStatus] - STATUS_PRECEDENCE[left.aggregateStatus];
  if (statusDifference !== 0) return statusDifference;

  const titleDifference = deterministicStringCompare(left.title, right.title);
  if (titleDifference !== 0) return titleDifference;
  return deterministicStringCompare(left.id, right.id);
}

function compareSidebarNodesByName(
  left: SidebarSortableNode,
  right: SidebarSortableNode,
): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const titleDifference = deterministicStringCompare(left.title, right.title);
  if (titleDifference !== 0) return titleDifference;
  return deterministicStringCompare(left.id, right.id);
}

export function partitionVisibleNodes<T extends { pinned: boolean }>(
  nodes: readonly T[],
  requestedLimit: number,
): SidebarVisiblePartition<T> {
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : 0;
  const pinnedCount = nodes.reduce((count, node) => count + (node.pinned ? 1 : 0), 0);
  let remainingRegularSlots = Math.max(0, limit - pinnedCount);
  const visible: T[] = [];
  const overflow: T[] = [];

  for (const node of nodes) {
    if (node.pinned) {
      visible.push(node);
      continue;
    }
    if (remainingRegularSlots > 0) {
      visible.push(node);
      remainingRegularSlots -= 1;
      continue;
    }
    overflow.push(node);
  }

  return { visible, overflow };
}

export function assertSidebarProjectBranchInput(
  input: unknown,
): asserts input is SidebarProjectBranchInput {
  if (!isRecord(input)) {
    throw new TypeError("Sidebar project branch input must be an object");
  }
  requireNonBlank(input.projectSlug as string, "projectSlug");
  requireNonBlank(input.projectTitle as string, "projectTitle");
  if (typeof input.archived !== "boolean") {
    throw new TypeError("archived must be a boolean");
  }
  requireArray(input.issues, "issues");
  validateIssueEntries(input.issues);
  if (!isIterableCollection(input.executions)) {
    throw new TypeError("executions must be an iterable collection");
  }
  requireArray(input.relatedSessions, "relatedSessions");
  validateRecentEntries(input.relatedSessions);
  requireArray(input.assistantThreads, "assistantThreads");
  validateAssistantThreadEntries(input.assistantThreads);
  requireArray(input.inventory, "inventory");
  validateInventoryEntries(input.inventory);
  if (!isLoadState(input.loadState)) {
    throw new TypeError("loadState must be one of idle, loading, ready, error, stale");
  }
  if (!("error" in input) || (input.error !== null && typeof input.error !== "string")) {
    throw new TypeError("error must be a string or null");
  }
  assertSidebarTreeBuildOptions(input.options);
}

export function normalizeSidebarProjectBranchInput(
  input: unknown,
): NormalizedSidebarProjectBranchInput {
  assertSidebarProjectBranchInput(input);
  return {
    ...input,
    projectSlug: input.projectSlug.trim(),
    projectTitle: input.projectTitle.trim(),
    executions: normalizeExecutions(input.executions),
    error: input.error == null ? null : nonBlank(input.error),
    options: normalizeOptions(input.options),
  };
}

function assertSidebarTreeBuildOptions(options: unknown): asserts options is SidebarTreeBuildOptions {
  if (!isRecord(options)) {
    throw new TypeError("options must be an object");
  }
  requireSet(options.pinnedProjectIds, "pinnedProjectIds");
  requireSet(options.pinnedWorkspaceIds, "pinnedWorkspaceIds");
  requireSet(options.pinnedSessionIds, "pinnedSessionIds");
  if (
    !(options.lastReadAtBySession instanceof Map) &&
    !isPlainRecord(options.lastReadAtBySession)
  ) {
    throw new TypeError("lastReadAtBySession must be a plain object or Map");
  }
  const readEntries =
    options.lastReadAtBySession instanceof Map
      ? options.lastReadAtBySession.entries()
      : Object.entries(options.lastReadAtBySession);
  for (const [sessionId, timestamp] of readEntries) {
    if (typeof sessionId !== "string" || typeof timestamp !== "string") {
      throw new TypeError("lastReadAtBySession keys and values must be strings");
    }
  }
  if (options.sortMode !== "activity" && options.sortMode !== "name") {
    throw new TypeError("sortMode must be one of activity, name");
  }
  if (options.groupMode !== undefined && !VALID_GROUP_MODES.has(options.groupMode as SidebarGroupMode)) {
    throw new TypeError("groupMode must be one of none, workspaceKind, status");
  }
  if (options.filters !== undefined) {
    if (!isRecord(options.filters)) {
      throw new TypeError("filters must be an object");
    }
    if (
      options.filters.statuses !== undefined &&
      (!Array.isArray(options.filters.statuses) ||
        options.filters.statuses.some((status) => typeof status !== "string"))
    ) {
      throw new TypeError("filters.statuses must be an array of strings");
    }
    if (
      options.filters.agents !== undefined &&
      (!Array.isArray(options.filters.agents) ||
        options.filters.agents.some(
          (agent) => typeof agent !== "string" || !VALID_FILTER_AGENTS.has(agent as SidebarFilterAgent),
        ))
    ) {
      throw new TypeError("filters.agents must be an array of known agent kinds");
    }
    if (
      options.filters.showArchived !== undefined &&
      typeof options.filters.showArchived !== "boolean"
    ) {
      throw new TypeError("filters.showArchived must be a boolean");
    }
    if (
      options.filters.activityOnly !== undefined &&
      typeof options.filters.activityOnly !== "boolean"
    ) {
      throw new TypeError("filters.activityOnly must be a boolean");
    }
  }
  assertOptionalLimit(options.workspaceLimit, "workspaceLimit");
  assertOptionalLimit(options.sessionLimit, "sessionLimit");
}

function normalizeOptions(options: SidebarTreeBuildOptions): NormalizedSidebarTreeBuildOptions {
  const filters = options.filters ?? {};
  return {
    ...options,
    workspaceLimit: options.workspaceLimit ?? SIDEBAR_DEFAULT_WORKSPACE_LIMIT,
    sessionLimit: options.sessionLimit ?? SIDEBAR_DEFAULT_SESSION_LIMIT,
    groupMode: options.groupMode ?? "none",
    filters: {
      statuses: [...(filters.statuses ?? DEFAULT_TREE_FILTERS.statuses)],
      agents: [...(filters.agents ?? DEFAULT_TREE_FILTERS.agents)],
      showArchived: filters.showArchived ?? DEFAULT_TREE_FILTERS.showArchived,
      activityOnly: filters.activityOnly ?? DEFAULT_TREE_FILTERS.activityOnly,
    },
  };
}

function validateIssueEntries(values: readonly unknown[]): void {
  values.forEach((value, index) => {
    const path = `issues[${index}]`;
    const issue = requireIndexedRecord(value, path);
    requireIndexedNonBlankString(issue.identifier, `${path}.identifier`);
    requireIndexedNonBlankString(issue.projectSlug, `${path}.projectSlug`);
    requireIndexedNonBlankString(issue.title, `${path}.title`);
    requireIndexedString(issue.updatedAt, `${path}.updatedAt`);
  });
}

function validateRecentEntries(values: readonly unknown[]): void {
  values.forEach((value, index) => {
    const path = `relatedSessions[${index}]`;
    const session = requireIndexedRecord(value, path);
    requireIndexedNonBlankString(session.id, `${path}.id`);
    if (session.kind !== "chat" && session.kind !== "codex") {
      throw new TypeError(`${path}.kind must be chat or codex`);
    }
    requireIndexedNullableString(session.scope, `${path}.scope`);
    requireIndexedNullableString(session.projectSlug, `${path}.projectSlug`);
    requireIndexedString(session.title, `${path}.title`);
    requireIndexedNullableString(session.identifier, `${path}.identifier`);
    requireIndexedNullableInteger(session.threadId, `${path}.threadId`);
    requireIndexedString(session.status, `${path}.status`);
    requireIndexedString(session.statusKind, `${path}.statusKind`);
    requireIndexedString(session.updatedAt, `${path}.updatedAt`);
  });
}

function validateAssistantThreadEntries(values: readonly unknown[]): void {
  values.forEach((value, index) => {
    const path = `assistantThreads[${index}]`;
    const thread = requireIndexedRecord(value, path);
    if (!Number.isInteger(thread.id) || (thread.id as number) <= 0) {
      throw new TypeError(`${path}.id must be a positive integer`);
    }
    requireIndexedNonBlankString(thread.scope, `${path}.scope`);
    requireIndexedNullableString(thread.projectSlug, `${path}.projectSlug`);
    requireIndexedNullableString(thread.issueIdentifier, `${path}.issueIdentifier`);
    requireIndexedNullableString(thread.workspacePath, `${path}.workspacePath`);
    requireIndexedNullableString(thread.title, `${path}.title`);
    requireIndexedString(thread.status, `${path}.status`);
    requireIndexedString(thread.updatedAt, `${path}.updatedAt`);
    if (typeof thread.needsReview !== "boolean") {
      throw new TypeError(`${path}.needsReview must be a boolean`);
    }
  });
}

function validateInventoryEntries(values: readonly unknown[]): void {
  values.forEach((value, index) => {
    const path = `inventory[${index}]`;
    const inventory = requireIndexedRecord(value, path);
    requireIndexedNonBlankString(inventory.path, `${path}.path`);
    requireIndexedNonBlankString(inventory.kind, `${path}.kind`);
    requireIndexedNonBlankString(inventory.classification, `${path}.classification`);
    requireIndexedNullableString(inventory.displayName, `${path}.displayName`);
    requireIndexedNullableString(inventory.name, `${path}.name`);
    requireIndexedNullableString(inventory.issueIdentifier, `${path}.issueIdentifier`);
    requireIndexedNullableString(inventory.executionStatus, `${path}.executionStatus`);
    requireArray(inventory.repos, `${path}.repos`);
    inventory.repos.forEach((repo, repoIndex) => {
      const repoPath = `${path}.repos[${repoIndex}]`;
      const record = requireIndexedRecord(repo, repoPath);
      requireIndexedNullableString(record.branch, `${repoPath}.branch`);
    });
    requireArray(inventory.childWorktrees, `${path}.childWorktrees`);
    inventory.childWorktrees.forEach((worktree, worktreeIndex) => {
      requireIndexedRecord(worktree, `${path}.childWorktrees[${worktreeIndex}]`);
    });
  });
}

function prepareProjectSources(
  input: NormalizedSidebarProjectBranchInput,
): PreparedProjectSources {
  const projectIssues = input.issues.filter(
    (issue) => issue.projectSlug === input.projectSlug,
  );
  const projectSessions = deduplicateNewest(
    input.relatedSessions.filter(
      (session) =>
        session.projectSlug === input.projectSlug &&
        session.scope !== "freeform",
    ),
    recentEmittedIdentity,
    (session) => session.updatedAt,
    recentTieKey,
  ).sort((left, right) => deterministicStringCompare(left.id, right.id));
  const projectThreads = deduplicateNewest(
    input.assistantThreads.filter(
      (thread) =>
        thread.projectSlug === input.projectSlug &&
        thread.scope !== "freeform",
    ),
    (thread) => String(thread.id),
    (thread) => thread.updatedAt,
    threadTieKey,
  ).sort((left, right) =>
    deterministicStringCompare(String(left.id), String(right.id)),
  );
  const threadById = new Map(projectThreads.map((thread) => [thread.id, thread]));
  const authoringRecentByIssue = new Map<string, RecentSession>();
  for (const session of projectSessions) {
    if (session.scope !== "issue" || !session.identifier) continue;
    const current = authoringRecentByIssue.get(session.identifier);
    if (!current || isPreferredNewest(session, current, (value) => value.id)) {
      authoringRecentByIssue.set(session.identifier, session);
    }
  }
  return {
    projectIssues,
    projectSessions,
    projectThreads,
    threadById,
    authoringRecentByIssue,
  };
}

function deduplicateNewest<T>(
  values: readonly T[],
  idOf: (value: T) => string,
  updatedAtOf: (value: T) => string,
  tieKeyOf: (value: T) => string,
): T[] {
  const byId = new Map<string, T>();
  for (const value of values) {
    const id = idOf(value);
    const current = byId.get(id);
    if (!current) {
      byId.set(id, value);
      continue;
    }
    const valueTimestamp = timestampValue(updatedAtOf(value));
    const currentTimestamp = timestampValue(updatedAtOf(current));
    if (
      valueTimestamp > currentTimestamp ||
      (valueTimestamp === currentTimestamp &&
        deterministicStringCompare(tieKeyOf(value), tieKeyOf(current)) < 0)
    ) {
      byId.set(id, value);
    }
  }
  return [...byId.values()];
}

function isPreferredNewest<T extends { updatedAt: string }>(
  candidate: T,
  current: T,
  stableIdOf: (value: T) => string,
): boolean {
  const candidateTimestamp = timestampValue(candidate.updatedAt);
  const currentTimestamp = timestampValue(current.updatedAt);
  if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp;
  return deterministicStringCompare(stableIdOf(candidate), stableIdOf(current)) < 0;
}

function recentEmittedIdentity(session: RecentSession): string {
  if (session.scope !== "issue" && session.threadId != null) {
    return `thread:${session.threadId}`;
  }
  return `source:${session.id}`;
}

function recentTieKey(session: RecentSession): string {
  return [
    session.id,
    String(session.threadId ?? ""),
    session.scope ?? "",
    session.identifier ?? "",
    session.title,
    session.status,
  ].join("\u0000");
}

function threadTieKey(thread: AssistantThread): string {
  return [
    String(thread.id),
    thread.scope,
    thread.issueIdentifier ?? "",
    thread.workspacePath ?? "",
    thread.title ?? "",
    thread.status,
  ].join("\u0000");
}

function normalizeExecutions(
  source: SidebarProjectBranchInput["executions"],
): AgentExecution[] {
  const values: AgentExecution[] = [];
  for (const item of source) {
    if (Array.isArray(item) && item.length === 2) {
      const execution = item[1] as AgentExecution;
      if (!execution || !nonBlank(execution.issueIdentifier)) {
        throw new TypeError("executions must contain values with non-blank issueIdentifier");
      }
      values.push(execution);
      continue;
    }
    const execution = item as AgentExecution;
    if (!execution || !nonBlank(execution.issueIdentifier)) {
      throw new TypeError("executions must contain values with non-blank issueIdentifier");
    }
    values.push(execution);
  }
  return values;
}

function workspaceFromCard(
  card: WorkspaceCard,
  input: NormalizedSidebarProjectBranchInput,
  issueUpdatedAt: ReadonlyMap<string, string>,
): MutableSidebarWorkspaceNode {
  const id = workspaceId(card, input.projectSlug);
  const inventory = card.inventory ? cloneInventory(card.inventory) : null;
  const title =
    nonBlank(inventory?.displayName) ??
    (card.kind === "project" ? nonBlank(input.projectTitle) : null) ??
    nonBlank(card.title) ??
    nonBlank(inventory?.name) ??
    nonBlank(inventory?.path) ??
    card.issueIdentifier ??
    "Workspace";
  const issueTimestamp = card.issueIdentifier
    ? issueUpdatedAt.get(card.issueIdentifier) ?? ""
    : "";
  return {
    kind: "workspace",
    id,
    projectSlug: input.projectSlug,
    workspaceKind: workspaceKind(card),
    title,
    subtitle: card.issueIdentifier ?? inventory?.path ?? "",
    href: projectSessionsPath(input.projectSlug),
    branchSummary: branchSummary(inventory),
    aggregateStatus: inventoryStatus(inventory),
    updatedAt: issueTimestamp,
    inventory,
    issueIdentifier: card.issueIdentifier,
    sessions: [],
    overflowSessions: [],
    pinned: input.options.pinnedWorkspaceIds.has(id),
  };
}

function sessionNodesFromCard(
  card: WorkspaceCard,
  workspaceId: string,
  input: NormalizedSidebarProjectBranchInput,
  threadById: ReadonlyMap<number, AssistantThread>,
  authoringRecentByIssue: ReadonlyMap<string, RecentSession>,
  projectThreads: readonly AssistantThread[],
): Array<{ session: SidebarSessionNode; sourceThread?: AssistantThread }> {
  const sessions: Array<{ session: SidebarSessionNode; sourceThread?: AssistantThread }> = [];
  const executionThreadId = card.execution?.execution.executionSessionId ?? null;
  if (card.execution) {
    const executionNode = executionSessionNode(card, workspaceId, input);
    if (executionNode) sessions.push({ session: executionNode });
  }
  if (card.authoring) {
    const sourceRecent = authoringRecentByIssue.get(card.authoring.issueIdentifier);
    const sourceThread = findAuthoringThread(
      card.authoring.issueIdentifier,
      sourceRecent,
      threadById,
      projectThreads,
    );
    sessions.push({
      session: authoringSessionNode(
        card,
        workspaceId,
        input,
        sourceRecent,
        sourceThread,
      ),
      sourceThread,
    });
  }
  for (const recent of card.sessions) {
    // Card sessions now carry every thread (authoring, execution, chats); the
    // sidebar already renders dedicated authoring/execution nodes above, so
    // skip those threads here to keep node ids unique.
    if (recent.scope === "issue" && card.authoring) continue;
    if (recent.threadId != null && recent.threadId === executionThreadId) continue;
    const sourceThread = recent.threadId == null ? undefined : threadById.get(recent.threadId);
    sessions.push({
      session: chatSessionNode(recent, workspaceId, input, sourceThread),
      sourceThread,
    });
  }
  return sessions;
}

function findAuthoringThread(
  issueIdentifier: string,
  sourceRecent: RecentSession | undefined,
  threadById: ReadonlyMap<number, AssistantThread>,
  projectThreads: readonly AssistantThread[],
): AssistantThread | undefined {
  if (sourceRecent?.threadId != null) {
    const exactThread = threadById.get(sourceRecent.threadId);
    if (exactThread) return exactThread;
  }
  let newest: AssistantThread | undefined;
  for (const thread of projectThreads) {
    if (thread.scope !== "issue" || thread.issueIdentifier !== issueIdentifier) continue;
    if (!newest || isPreferredNewest(thread, newest, (value) => String(value.id))) {
      newest = thread;
    }
  }
  return newest;
}

function executionSessionNode(
  card: WorkspaceCard,
  workspaceId: string,
  input: NormalizedSidebarProjectBranchInput,
): SidebarSessionNode | null {
  const execution = card.execution!;
  const threadId = execution.execution.executionSessionId;
  if (threadId == null || threadId <= 0) return null;

  const id = `thread:${threadId}`;
  const updatedAt = validTimestampString(execution.lastEventAt ?? execution.startedAt);
  return {
    kind: "session",
    id,
    projectSlug: input.projectSlug,
    workspaceId,
    sessionKind: "execution",
    title: nonBlank(execution.title) ?? execution.issueIdentifier,
    subtitle: execution.issueIdentifier,
    href: projectSessionPath(input.projectSlug, threadId),
    statusKind: executionStatusKind(execution.status),
    aggregateStatus: statusToAggregate(execution.status),
    agentKind: execution.agentKind,
    updatedAt,
    threadId,
    issueIdentifier: execution.issueIdentifier,
    archived: execution.status === "saved",
    unread: false,
    needsReview: false,
    labels: null,
    issueLabelNames: issueLabels(input, execution.issueIdentifier),
    pinned: input.options.pinnedSessionIds.has(id),
  };
}

function authoringSessionNode(
  card: WorkspaceCard,
  workspaceId: string,
  input: NormalizedSidebarProjectBranchInput,
  sourceRecent: RecentSession | undefined,
  sourceThread: AssistantThread | undefined,
): SidebarSessionNode {
  const authoring = card.authoring!;
  const id = `authoring:${authoring.issueIdentifier}`;
  const updatedAt = newestTimestamp([
    authoring.updatedAt,
    sourceRecent?.updatedAt ?? "",
    sourceThread?.updatedAt ?? "",
  ]);
  const statusKind = normalizeRecentStatus(sourceThread?.status ?? sourceRecent?.statusKind ?? "idle");
  const needsReview = sourceThread?.needsReview === true;
  return {
    kind: "session",
    id,
    projectSlug: input.projectSlug,
    workspaceId,
    sessionKind: "authoring",
    title: nonBlank(authoring.title) ?? authoring.issueIdentifier,
    subtitle: authoring.issueIdentifier,
    href: projectAuthoringSessionPath(input.projectSlug, authoring.issueIdentifier),
    statusKind,
    aggregateStatus: statusWithReview(statusKind, needsReview),
    agentKind: sourceThread?.agentKind ?? authoring.agentKind,
    updatedAt,
    threadId: sourceThread?.id ?? sourceRecent?.threadId ?? null,
    issueIdentifier: authoring.issueIdentifier,
    archived: sourceThread?.status === "archived",
    unread: unreadFromLastRead(id, updatedAt, input.options, false),
    needsReview,
    labels: sourceThread ? [...sourceThread.labels] : null,
    issueLabelNames: issueLabels(input, authoring.issueIdentifier),
    pinned: input.options.pinnedSessionIds.has(id),
  };
}

function chatSessionNode(
  recent: RecentSession,
  workspaceId: string | null,
  input: NormalizedSidebarProjectBranchInput,
  sourceThread?: AssistantThread,
): SidebarSessionNode {
  const threadIdentifier = recent.threadId ?? recent.id;
  const id = `thread:${threadIdentifier}`;
  const updatedAt = validTimestampString(sourceThread?.updatedAt ?? recent.updatedAt);
  const statusKind = normalizeRecentStatus(sourceThread?.status ?? recent.statusKind);
  const needsReview = sourceThread?.needsReview === true;
  return {
    kind: "session",
    id,
    projectSlug: input.projectSlug,
    workspaceId,
    sessionKind: "chat",
    title: nonBlank(sourceThread?.title) ?? nonBlank(recent.title) ?? sessionFallbackTitle(threadIdentifier),
    subtitle: recent.identifier ?? recent.projectName ?? input.projectTitle,
    href: recentSessionPath(recent),
    statusKind,
    aggregateStatus: statusWithReview(statusKind, needsReview),
    agentKind: sourceThread?.agentKind ?? recent.agentKind,
    updatedAt,
    threadId: recent.threadId,
    issueIdentifier: sourceThread?.issueIdentifier ?? recent.identifier,
    archived: sourceThread?.status === "archived" || recent.status === "archived",
    unread: unreadFromLastRead(id, updatedAt, input.options, true),
    needsReview,
    labels: sourceThread ? [...sourceThread.labels] : null,
    issueLabelNames: issueLabels(
      input,
      sourceThread?.issueIdentifier ?? recent.identifier,
    ),
    pinned: input.options.pinnedSessionIds.has(id),
  };
}

function threadSessionNode(
  thread: AssistantThread,
  workspaceId: string | null,
  input: NormalizedSidebarProjectBranchInput,
): SidebarSessionNode {
  const id = `thread:${thread.id}`;
  const updatedAt = validTimestampString(thread.updatedAt);
  const statusKind = normalizeRecentStatus(thread.status);
  return {
    kind: "session",
    id,
    projectSlug: input.projectSlug,
    workspaceId,
    sessionKind: "chat",
    title: nonBlank(thread.title) ?? sessionFallbackTitle(thread.id),
    subtitle: thread.issueIdentifier ?? thread.projectName ?? input.projectTitle,
    href: projectSessionPath(input.projectSlug, thread.id),
    statusKind,
    aggregateStatus: statusWithReview(statusKind, thread.needsReview),
    agentKind: thread.agentKind,
    updatedAt,
    threadId: thread.id,
    issueIdentifier: thread.issueIdentifier,
    archived: thread.status === "archived",
    unread: unreadFromLastRead(id, updatedAt, input.options, true),
    needsReview: thread.needsReview,
    labels: [...thread.labels],
    issueLabelNames: issueLabels(input, thread.issueIdentifier),
    pinned: input.options.pinnedSessionIds.has(id),
  };
}

function issueLabels(
  input: NormalizedSidebarProjectBranchInput,
  identifier: string | null | undefined,
): readonly string[] | null {
  if (!identifier) return null;
  const issue = input.issues.find(
    (candidate) =>
      candidate.projectSlug === input.projectSlug &&
      candidate.identifier === identifier,
  );
  return issue ? [...issue.labels] : null;
}

function completeWorkspace(
  workspace: SidebarWorkspaceNode,
  options: NormalizedSidebarTreeBuildOptions,
): SidebarWorkspaceNode {
  const sortedSessions = sortSidebarNodes(workspace.sessions, options.sortMode);
  const partition = partitionVisibleNodes(sortedSessions, options.sessionLimit);
  const workspaceAggregateStatus = aggregateStatus([
    workspace.aggregateStatus,
    ...sortedSessions.map((session) => session.aggregateStatus),
  ]);
  return {
    ...workspace,
    aggregateStatus: workspaceAggregateStatus,
    updatedAt: newestTimestamp([workspace.updatedAt, ...sortedSessions.map((session) => session.updatedAt)]),
    sessions: partition.visible,
    overflowSessions: partition.overflow,
  };
}

export function sortSidebarNodes<T extends SidebarSortableNode>(
  nodes: readonly T[],
  sortMode: SidebarSortMode,
): T[] {
  return [...nodes].sort(sortMode === "name" ? compareSidebarNodesByName : compareSidebarNodes);
}

function workspaceId(card: WorkspaceCard, projectSlug: string): string {
  if (card.inventory) return `workspace:${projectSlug}:${card.inventory.path}`;
  if (card.issueIdentifier) return `workspace:${projectSlug}:issue:${card.issueIdentifier}`;
  return `workspace:${projectSlug}:${card.key}`;
}

function workspaceKind(card: WorkspaceCard): SidebarWorkspaceKind {
  if (card.section === "orphan" || card.kind === "orphan") return "orphan";
  if (card.kind === "issue_parallel") return "parallel";
  return card.kind;
}

function branchSummary(inventory: WorkspaceInventoryEntry | null): string | null {
  if (!inventory) return null;
  const branches = inventory.repos
    .map((repo) => nonBlank(repo.branch))
    .filter((branch): branch is string => branch != null);
  return [...new Set(branches)].join(" · ") || null;
}

function cloneInventory(inventory: WorkspaceInventoryEntry): WorkspaceInventoryEntry {
  return {
    ...inventory,
    repos: inventory.repos.map((repo) => ({ ...repo })),
    childWorktrees: inventory.childWorktrees.map((worktree) => ({ ...worktree })),
  };
}

function inventoryStatus(inventory: WorkspaceInventoryEntry | null): SidebarAggregateStatus {
  if (!inventory) return "idle";
  return statusToAggregate(inventory.executionStatus);
}

function statusToAggregate(status: string | null | undefined): SidebarAggregateStatus {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (ERROR_STATUSES.has(normalized)) return "error";
  if (ATTENTION_STATUSES.has(normalized)) return "attention";
  if (ACTIVE_STATUSES.has(normalized)) return "active";
  return "idle";
}

function statusWithReview(
  status: string | null | undefined,
  needsReview: boolean,
): SidebarAggregateStatus {
  return aggregateStatus([
    statusToAggregate(status),
    needsReview ? "attention" : "idle",
  ]);
}

function executionStatusKind(status: AgentExecutionStatus): RecentStatusKind {
  switch (status) {
    case "live":
      return "running";
    case "paused":
      return "waiting";
    case "saved":
      return "done";
    case "idle":
    case "waiting":
    case "retrying":
    case "error":
    case "aborted":
      return status;
  }
}

function normalizeRecentStatus(status: string): RecentStatusKind {
  const normalized = status.trim().toLowerCase();
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

function deterministicStringCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sessionFallbackTitle(threadId: number | string | null | undefined): string {
  if (typeof threadId === "number" && Number.isInteger(threadId) && threadId > 0) {
    return `Session ${threadId}`;
  }
  if (typeof threadId === "string") {
    const trimmed = threadId.trim();
    if (/^\d+$/.test(trimmed)) return `Session ${trimmed}`;
  }
  return "Session";
}

function requireNonBlank(value: unknown, fieldName: string): string {
  const normalized = typeof value === "string" ? nonBlank(value) : null;
  if (!normalized) throw new TypeError(`${fieldName} must be a non-blank string`);
  return normalized;
}

function requireArray(value: unknown, fieldName: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
}

function requireIndexedRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function requireIndexedString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string`);
  }
}

function requireIndexedNonBlankString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-blank string`);
  }
}

function requireIndexedNullableString(
  value: unknown,
  path: string,
): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${path} must be a string or null`);
  }
}

function requireIndexedNullableInteger(
  value: unknown,
  path: string,
): asserts value is number | null {
  if (value !== null && !Number.isInteger(value)) {
    throw new TypeError(`${path} must be an integer or null`);
  }
}

function requireSet(value: unknown, fieldName: string): asserts value is ReadonlySet<string> {
  if (!(value instanceof Set)) {
    throw new TypeError(`${fieldName} must be a Set`);
  }
  for (const item of value) {
    if (typeof item !== "string") {
      throw new TypeError(`${fieldName} must contain only string IDs`);
    }
  }
}

function assertOptionalLimit(value: unknown, fieldName: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(`${fieldName} must be an integer`);
  }
  if (value < 0) {
    throw new TypeError(`${fieldName} must be non-negative`);
  }
}

function isIterableCollection(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

function isLoadState(value: unknown): value is SidebarLoadState {
  return (
    value === "idle" ||
    value === "loading" ||
    value === "ready" ||
    value === "error" ||
    value === "stale"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, string>> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
