import type { AgentKind } from "@/types/issue";
import type { RecentScope } from "@/types/recents";

export type ProjectSessionKind = "execution" | "authoring" | "chat" | "workspace_session" | "issue";

export interface ProjectSessionRow {
  id: string;
  title: string;
  kind: ProjectSessionKind;
  /** Assistant thread scope when the row comes from a persisted thread. */
  scope: RecentScope;
  href: string;
  updatedAt: string;
  aggregateStatus: string | null;
  agentKind: AgentKind | null;
  issueIdentifier: string | null;
  workspacePath: string | null;
  workspaceId: string | null;
  pinned: boolean;
  archived: boolean;
}

export interface ProjectSessionsPage {
  sessions: ProjectSessionRow[];
  nextCursor: string | null;
  projectActivityAt: string | null;
}
