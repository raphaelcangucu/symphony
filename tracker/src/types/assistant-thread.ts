export interface ModelProvenance {
  requestedModel: string | null;
  requestedEffort: string | null;
  resolvedModel: string | null;
  resolvedEffort: string | null;
}

export type ComposerPermissionLevel =
  | "ask_for_approval"
  | "approve_for_me"
  | "full_access";

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
  permissionLevel: ComposerPermissionLevel | null;
  title: string | null;
  status: string;
  preview: string | null;
  updatedAt: string;
}
