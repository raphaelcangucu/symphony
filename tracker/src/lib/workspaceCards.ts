import { PROJECT_SESSION_BUCKETS, groupProjectSessions, type ProjectSessionRow } from "@/lib/projectSessions";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";
import type { RecentSession } from "@/types/recents";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

export type WorkspaceCardSection = "project" | "active" | "waiting" | "orphan" | "chats";

/**
 * One card per working tree (or per issue for issues without an inventory
 * entry yet). Merges the execution session, the authoring session, the
 * parallel issue sessions, and the git/disk state of the tree — replacing the
 * one-card-per-session model of the old Sessions page.
 */
export interface WorkspaceCard {
  key: string;
  section: WorkspaceCardSection;
  kind: "project" | "standalone" | "issue" | "issue_parallel" | "orphan";
  issueIdentifier: string | null;
  title: string;
  /** Sort value: newest activity first within a section. */
  sortValue: number;
  inventory: WorkspaceInventoryEntry | null;
  execution: ProjectSessionRow | null;
  authoring: AuthoringSessionSummary | null;
  /** Parallel/clean chat sessions bound to this issue or tree. */
  sessions: RecentSession[];
}

export interface AuthoringSessionSummary {
  issueIdentifier: string;
  title: string;
  updatedAt: string;
  agentKind: ProjectSessionRow["agentKind"];
}

export interface WorkspaceCardsInput {
  executions: Iterable<AgentExecution>;
  issues: readonly Issue[];
  /** Project-scoped recent sessions (chats + codex snapshots). */
  relatedSessions: readonly RecentSession[];
  inventory: readonly WorkspaceInventoryEntry[];
}

export interface WorkspaceCardsResult {
  projectCards: WorkspaceCard[];
  activeCards: WorkspaceCard[];
  waitingCards: WorkspaceCard[];
  orphanCards: WorkspaceCard[];
  /** Free chats without a working tree, rendered in their own section. */
  chatSessions: RecentSession[];
}

export function buildWorkspaceCards(input: WorkspaceCardsInput): WorkspaceCardsResult {
  const groups = groupProjectSessions(input.executions, input.issues);
  const executionByIssue = new Map<string, ProjectSessionRow>();
  for (const bucket of PROJECT_SESSION_BUCKETS) {
    for (const row of groups[bucket]) executionByIssue.set(row.issueIdentifier, row);
  }

  const issueTitles = new Map(input.issues.map((issue) => [issue.identifier, issue.title]));
  const inventoryByIssue = new Map<string, WorkspaceInventoryEntry>();
  const parallelInventories: WorkspaceInventoryEntry[] = [];
  const standaloneInventories: WorkspaceInventoryEntry[] = [];
  const orphanInventories: WorkspaceInventoryEntry[] = [];
  let projectInventory: WorkspaceInventoryEntry | null = null;

  for (const entry of input.inventory) {
    if (entry.kind === "project") {
      projectInventory = entry;
      continue;
    }
    if (entry.kind === "standalone") {
      standaloneInventories.push(entry);
      continue;
    }
    if (entry.kind === "issue_parallel") {
      parallelInventories.push(entry);
      continue;
    }
    if (entry.kind === "issue" && entry.classification === "active" && entry.issueIdentifier) {
      inventoryByIssue.set(entry.issueIdentifier, entry);
      continue;
    }
    orphanInventories.push(entry);
  }

  const { authoringByIssue, parallelSessionsByIssue, chatSessions } = splitRelatedSessions(
    input.relatedSessions,
    executionByIssue,
    issueTitles,
  );

  const issueIdentifiers = new Set<string>([
    ...executionByIssue.keys(),
    ...authoringByIssue.keys(),
    ...parallelSessionsByIssue.keys(),
    ...inventoryByIssue.keys(),
  ]);

  const activeCards: WorkspaceCard[] = [];
  const waitingCards: WorkspaceCard[] = [];

  for (const identifier of issueIdentifiers) {
    const execution = executionByIssue.get(identifier) ?? null;
    const authoring = authoringByIssue.get(identifier) ?? null;
    const sessions = parallelSessionsByIssue.get(identifier) ?? [];
    const inventory = inventoryByIssue.get(identifier) ?? null;
    const title = issueTitles.get(identifier) ?? execution?.title ?? authoring?.title ?? identifier;

    const card: WorkspaceCard = {
      key: `issue:${identifier}`,
      section: issueSection(execution),
      kind: "issue",
      issueIdentifier: identifier,
      title,
      sortValue: issueSortValue(execution, authoring, sessions),
      inventory,
      execution,
      authoring,
      sessions,
    };

    if (card.section === "active") activeCards.push(card);
    else waitingCards.push(card);
  }

  const parallelCards = parallelInventories.map((entry): WorkspaceCard => {
    const identifier = entry.issueIdentifier;
    return {
      key: `parallel:${entry.path}`,
      section: entry.classification === "orphan" ? "orphan" : "active",
      kind: "issue_parallel",
      issueIdentifier: identifier,
      title: identifier ? (issueTitles.get(identifier) ?? identifier) : entry.path,
      sortValue: 0,
      inventory: entry,
      execution: null,
      authoring: null,
      sessions: [],
    };
  });

  for (const card of parallelCards) {
    if (card.section === "active") activeCards.push(card);
  }

  const projectCards: WorkspaceCard[] = [];
  if (projectInventory) {
    projectCards.push({
      key: "project",
      section: "project",
      kind: "project",
      issueIdentifier: null,
      title: "",
      sortValue: Number.MAX_SAFE_INTEGER,
      inventory: projectInventory,
      execution: null,
      authoring: null,
      sessions: chatSessions.projectWorkspaceSessions,
    });
  } else {
    // Without inventory data (e.g. scan unavailable) there is no project card
    // to host these sessions, so they must stay visible as plain chats.
    chatSessions.freeChats.unshift(...chatSessions.projectWorkspaceSessions);
  }

  for (const entry of standaloneInventories) {
    projectCards.push({
      key: `standalone:${entry.path}`,
      section: entry.classification === "orphan" ? "orphan" : "project",
      kind: "standalone",
      issueIdentifier: null,
      title: entry.name ?? entry.path,
      sortValue: 0,
      inventory: entry,
      execution: null,
      authoring: null,
      sessions: [],
    });
  }

  const orphanCards: WorkspaceCard[] = [
    ...orphanInventories.map(
      (entry): WorkspaceCard => ({
        key: `orphan:${entry.path}`,
        section: "orphan",
        kind: "orphan",
        issueIdentifier: entry.issueIdentifier,
        title: entry.issueIdentifier
          ? (issueTitles.get(entry.issueIdentifier) ?? entry.issueIdentifier)
          : (entry.name ?? entry.path),
        sortValue: 0,
        inventory: entry,
        execution: null,
        authoring: null,
        sessions: [],
      }),
    ),
    ...parallelCards.filter((card) => card.section === "orphan"),
    ...projectCards.filter((card) => card.section === "orphan"),
  ];

  activeCards.sort((a, b) => b.sortValue - a.sortValue);
  waitingCards.sort((a, b) => b.sortValue - a.sortValue);

  return {
    projectCards: projectCards.filter((card) => card.section === "project"),
    activeCards,
    waitingCards,
    orphanCards,
    chatSessions: chatSessions.freeChats,
  };
}

function issueSection(execution: ProjectSessionRow | null): WorkspaceCardSection {
  if (!execution) return "waiting";
  return execution.bucket === "active" ? "active" : "waiting";
}

function issueSortValue(
  execution: ProjectSessionRow | null,
  authoring: AuthoringSessionSummary | null,
  sessions: readonly RecentSession[],
): number {
  const values = [
    timestampValue(execution?.lastEventAt ?? execution?.startedAt ?? null),
    timestampValue(authoring?.updatedAt ?? null),
    ...sessions.map((session) => timestampValue(session.updatedAt)),
  ];
  return Math.max(0, ...values);
}

function splitRelatedSessions(
  relatedSessions: readonly RecentSession[],
  executionByIssue: ReadonlyMap<string, ProjectSessionRow>,
  issueTitles: ReadonlyMap<string, string>,
) {
  const authoringByIssue = new Map<string, AuthoringSessionSummary>();
  const parallelSessionsByIssue = new Map<string, RecentSession[]>();
  const projectWorkspaceSessions: RecentSession[] = [];
  const freeChats: RecentSession[] = [];

  for (const session of relatedSessions) {
    if (session.scope === "issue" && session.identifier) {
      const existing = authoringByIssue.get(session.identifier);
      if (!existing || timestampValue(session.updatedAt) > timestampValue(existing.updatedAt)) {
        authoringByIssue.set(session.identifier, {
          issueIdentifier: session.identifier,
          title: issueTitles.get(session.identifier) ?? session.title,
          updatedAt: session.updatedAt,
          agentKind: session.agentKind === "opencode" ? null : session.agentKind,
        });
      }
      continue;
    }

    if (session.scope === "issue_session" && session.identifier) {
      const list = parallelSessionsByIssue.get(session.identifier) ?? [];
      list.push(session);
      parallelSessionsByIssue.set(session.identifier, list);
      continue;
    }

    if (session.scope === "project_session" || session.scope === "project_explore") {
      projectWorkspaceSessions.push(session);
      continue;
    }

    if (session.kind === "codex" && session.identifier && executionByIssue.has(session.identifier)) {
      // Execution snapshot already represented by the execution row.
      continue;
    }

    freeChats.push(session);
  }

  // Executions can exist for issues whose authoring/parallel sessions were not
  // in recents; that's fine — the card simply shows the execution row alone.
  for (const sessions of parallelSessionsByIssue.values()) {
    sessions.sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
  }
  projectWorkspaceSessions.sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));
  freeChats.sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt));

  return {
    authoringByIssue,
    parallelSessionsByIssue,
    chatSessions: { projectWorkspaceSessions, freeChats },
  };
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / 2 ** (10 * exponent);
  const formatted = value >= 100 || exponent === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${units[exponent]}`;
}
