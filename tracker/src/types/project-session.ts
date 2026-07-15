import type { AgentKind } from "@/types/issue";

export type ProjectSessionKind = "execution" | "authoring" | "chat" | "workspace_session" | "issue";

export interface ProjectSessionRow {
  id: string;
  title: string;
  kind: ProjectSessionKind;
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
