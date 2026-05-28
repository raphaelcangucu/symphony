export interface WorkspaceTemplateRepository {
  id?: string;
  githubFullName: string;
  cloneUrl: string;
  defaultBranch: string | null;
  workspacePath: string;
  role: string | null;
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  validationCommands: string[];
  workflowStatuses: Array<Record<string, unknown>>;
  afterCreateHook: string | null;
  promptTemplate: string | null;
  devEnvMarkdown: string | null;
  metadata: Record<string, unknown>;
  repositories: WorkspaceTemplateRepository[];
}

export type CloneJobStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface CloneJob {
  id: string;
  repositoryId: string;
  status: CloneJobStatus;
  error: string | null;
  commitSha: string | null;
  startedAt: string | null;
  completedAt: string | null;
}
