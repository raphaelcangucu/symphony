export interface ModelProvenance {
  requestedModel: string | null;
  requestedEffort: string | null;
  resolvedModel: string | null;
  resolvedEffort: string | null;
}

export interface AssistantThread {
  id: number;
  scope: string;
  agentKind: "codex" | "claude" | "cursor" | "opencode" | null;
  requestedModel: string | null;
  requestedEffort: string | null;
  resolvedModel: string | null;
  resolvedEffort: string | null;
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
