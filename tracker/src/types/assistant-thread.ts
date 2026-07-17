export interface AssistantThread {
  id: number;
  scope: string;
  agentKind: "codex" | "claude" | "cursor" | "opencode" | null;
  projectSlug: string | null;
  projectName: string | null;
  issueIdentifier: string | null;
  workspacePath: string | null;
  labels: string[];
  needsReview: boolean;
  title: string | null;
  status: string;
  preview: string | null;
  updatedAt: string;
}
