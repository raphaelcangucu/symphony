export interface AssistantThread {
  id: number;
  scope: string;
  agentKind: "codex" | "claude" | "cursor" | null;
  projectSlug: string | null;
  projectName: string | null;
  issueIdentifier: string | null;
  title: string | null;
  status: string;
  preview: string | null;
  updatedAt: string;
}
