import type {
  AgentKind,
  AssistantThread,
  ProjectSessionRow,
  ProjectSummary,
} from "@/api/contracts";

export type SessionTreeState = "attention" | "running" | "queued" | "idle";

export type SessionTreeRow = {
  id: string;
  threadId: number | null;
  projectSlug: string | null;
  title: string;
  preview: string | null;
  issueIdentifier: string | null;
  workspacePath: string | null;
  updatedAt: string;
  agentKind: AgentKind | null;
  state: SessionTreeState;
  pinned: boolean;
  archived: boolean;
};

export type SessionTreeGroup = {
  key: string;
  projectSlug: string | null;
  title: string;
  count: number;
  collapsed: boolean;
  sessions: SessionTreeRow[];
};

export type BuildSessionTreeInput = {
  projects: ProjectSummary[];
  threads: AssistantThread[];
  projectSessions: Record<string, ProjectSessionRow[]>;
  query: string;
  collapsedProjectSlugs: Set<string>;
  includeArchived: boolean;
};

type MutableSession = SessionTreeRow & {
  aggregateStatus: string | null;
  needsReview: boolean;
};

export function buildSessionTree(input: BuildSessionTreeInput): SessionTreeGroup[] {
  const projects = new Map(input.projects.map((project) => [project.slug, project]));
  const sessions = new Map<string, MutableSession>();

  for (const thread of input.threads) {
    sessions.set(threadKey(thread.id), fromThread(thread));
    if (thread.projectSlug && !projects.has(thread.projectSlug)) {
      projects.set(thread.projectSlug, {
        id: thread.projectSlug,
        slug: thread.projectSlug,
        name: thread.projectName ?? thread.projectSlug,
      });
    }
  }

  for (const [projectSlug, rows] of Object.entries(input.projectSessions)) {
    if (!projects.has(projectSlug)) {
      projects.set(projectSlug, {
        id: projectSlug,
        slug: projectSlug,
        name: projectSlug,
      });
    }
    for (const row of rows) {
      const threadId = resolveThreadId(row);
      const key = threadId === null ? `session:${projectSlug}:${row.id}` : threadKey(threadId);
      const existing = sessions.get(key);
      sessions.set(
        key,
        existing
          ? mergeProjectSession(existing, row)
          : fromProjectSession(projectSlug, row, threadId),
      );
    }
  }

  const grouped = new Map<string | null, MutableSession[]>();
  for (const session of sessions.values()) {
    if (!input.includeArchived && session.archived) continue;
    const current = grouped.get(session.projectSlug) ?? [];
    current.push(session);
    grouped.set(session.projectSlug, current);
  }

  const normalizedQuery = normalizeSearch(input.query);
  const projectGroups = [...projects.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((project) =>
      createGroup({
        key: `project:${project.slug}`,
        projectSlug: project.slug,
        title: project.name,
        sessions: grouped.get(project.slug) ?? [],
        query: normalizedQuery,
        collapsed: input.collapsedProjectSlugs.has(project.slug),
      }),
    )
    .filter((group) => normalizedQuery === "" || group.count > 0);

  const freeform = createGroup({
    key: "freeform",
    projectSlug: null,
    title: "Free",
    sessions: grouped.get(null) ?? [],
    query: normalizedQuery,
    collapsed: input.collapsedProjectSlugs.has("freeform"),
  });

  return freeform.count > 0 ? [...projectGroups, freeform] : projectGroups;
}

function createGroup(input: {
  key: string;
  projectSlug: string | null;
  title: string;
  sessions: MutableSession[];
  query: string;
  collapsed: boolean;
}): SessionTreeGroup {
  const projectMatches = input.query !== "" && normalizeSearch(input.title).includes(input.query);
  const visible =
    input.query === "" || projectMatches
      ? input.sessions
      : input.sessions.filter((session) => sessionMatches(session, input.query));
  const sorted = [...visible].sort(compareSessions).map(stripInternalState);

  return {
    key: input.key,
    projectSlug: input.projectSlug,
    title: input.title,
    count: sorted.length,
    collapsed: input.collapsed,
    sessions: input.collapsed ? [] : sorted,
  };
}

function fromThread(thread: AssistantThread): MutableSession {
  return {
    id: threadKey(thread.id),
    threadId: thread.id,
    projectSlug: thread.projectSlug,
    title: deriveTitle(thread.title, thread.issueIdentifier, thread.preview),
    preview: optionalText(thread.preview),
    issueIdentifier: optionalText(thread.issueIdentifier),
    workspacePath: optionalText(thread.workspacePath),
    updatedAt: thread.updatedAt,
    agentKind: thread.agentKind,
    state: deriveState(thread.needsReview, null, thread.status),
    pinned: false,
    archived: false,
    aggregateStatus: null,
    needsReview: thread.needsReview,
  };
}

function fromProjectSession(
  projectSlug: string,
  row: ProjectSessionRow,
  threadId: number | null,
): MutableSession {
  return {
    id: threadId === null ? `session:${projectSlug}:${row.id}` : threadKey(threadId),
    threadId,
    projectSlug,
    title: deriveTitle(row.title, row.issueIdentifier, null),
    preview: null,
    issueIdentifier: optionalText(row.issueIdentifier),
    workspacePath: optionalText(row.workspacePath),
    updatedAt: row.updatedAt,
    agentKind: row.agentKind,
    state: deriveState(false, row.aggregateStatus, null),
    pinned: row.pinned,
    archived: row.archived,
    aggregateStatus: row.aggregateStatus,
    needsReview: false,
  };
}

function mergeProjectSession(session: MutableSession, row: ProjectSessionRow): MutableSession {
  const aggregateStatus = row.aggregateStatus ?? session.aggregateStatus;
  return {
    ...session,
    issueIdentifier: session.issueIdentifier ?? optionalText(row.issueIdentifier),
    workspacePath: session.workspacePath ?? optionalText(row.workspacePath),
    updatedAt: newestTimestamp(session.updatedAt, row.updatedAt),
    agentKind: session.agentKind ?? row.agentKind,
    state: deriveState(session.needsReview, aggregateStatus, session.state),
    pinned: session.pinned || row.pinned,
    archived: session.archived || row.archived,
    aggregateStatus,
  };
}

function deriveTitle(
  title: string | null,
  issueIdentifier: string | null,
  preview: string | null,
): string {
  return (
    optionalText(title) ?? optionalText(issueIdentifier) ?? optionalText(preview) ?? "New session"
  );
}

function deriveState(
  needsReview: boolean,
  aggregateStatus: string | null,
  threadStatus: string | null,
): SessionTreeState {
  if (needsReview) return "attention";
  const status = normalizeSearch(aggregateStatus ?? threadStatus ?? "");
  if (
    status.includes("running") ||
    status.includes("active") ||
    status.includes("streaming") ||
    status.includes("in progress")
  ) {
    return "running";
  }
  if (status.includes("queued") || status.includes("pending")) return "queued";
  return "idle";
}

function compareSessions(left: MutableSession, right: MutableSession): number {
  const priority = sessionPriority(left) - sessionPriority(right);
  if (priority !== 0) return priority;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function sessionPriority(session: MutableSession): number {
  if (session.state === "attention") return 0;
  if (session.state === "running") return 1;
  if (session.state === "queued") return 2;
  if (session.pinned) return 3;
  return 4;
}

function sessionMatches(session: MutableSession, query: string): boolean {
  return [session.title, session.issueIdentifier ?? "", session.preview ?? ""].some((value) =>
    normalizeSearch(value).includes(query),
  );
}

function stripInternalState(session: MutableSession): SessionTreeRow {
  const { aggregateStatus: _aggregateStatus, needsReview: _needsReview, ...row } = session;
  return row;
}

function resolveThreadId(row: ProjectSessionRow): number | null {
  if (row.threadId !== null) return row.threadId;
  const match = /^thread:(\d+)$/.exec(row.id);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function threadKey(threadId: number): string {
  return `thread:${threadId}`;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase();
}

function optionalText(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function newestTimestamp(left: string, right: string): string {
  return right.localeCompare(left) > 0 ? right : left;
}
