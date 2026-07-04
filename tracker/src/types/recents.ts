export type RecentKind = "chat" | "codex";
export type RecentScope = "project" | "project_session" | "project_explore" | "freeform" | "issue" | null;
export type RecentStatusKind =
  | "running" | "waiting" | "retrying" | "idle" | "active"
  | "closed" | "error" | "done" | "in_progress" | "todo";

export interface RecentSession {
  id: string;
  kind: RecentKind;
  scope: RecentScope;
  agentKind: "codex" | "claude" | "cursor" | null;
  projectSlug: string | null;
  projectName: string | null;
  title: string;
  identifier: string | null;
  threadId: number | null;
  status: string;
  statusKind: RecentStatusKind;
  preview: string | null;
  updatedAt: string;
}
