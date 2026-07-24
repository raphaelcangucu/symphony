export type AgentKind = "codex" | "claude" | "cursor" | "opencode";

export type Health = {
  status: string;
};

export type Viewer = {
  id: string;
  name: string;
};

export type ProjectSummary = {
  id: string;
  slug: string;
  name: string;
};

export type AssistantThread = {
  id: number;
  scope: string;
  projectSlug: string | null;
  projectName: string | null;
  issueIdentifier: string | null;
  workspacePath: string | null;
  title: string | null;
  status: string;
  preview: string | null;
  updatedAt: string;
  agentKind: AgentKind | null;
  needsReview: boolean;
};

export type ProjectSessionRow = {
  id: string;
  threadId: number | null;
  title: string;
  kind: string;
  scope: string;
  href: string;
  updatedAt: string;
  aggregateStatus: string | null;
  agentKind: AgentKind | null;
  issueIdentifier: string | null;
  workspacePath: string | null;
  workspaceId: string | null;
  pinned: boolean;
  archived: boolean;
};

export type ProjectSessionsPage = {
  sessions: ProjectSessionRow[];
  nextCursor: string | null;
};

export type AssistantEffortOption = {
  effort: string;
  label: string;
};

export type AssistantModelOption = {
  model: string;
  label: string;
  efforts: AssistantEffortOption[];
};

export type AssistantAgentCatalog = {
  agent: AgentKind;
  agentLabel: string;
  defaultModel: string | null;
  models: AssistantModelOption[];
};

export type AssistantCatalog = {
  defaultAgent: AgentKind;
  agents: AssistantAgentCatalog[];
};

export type ThreadListOptions = {
  scope?: string;
  scopes?: string[];
  projectSlug?: string;
  issueIdentifier?: string;
  limit?: number;
  includeArchived?: boolean;
};

export type ProjectSessionListOptions = {
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
};

type CreateThreadSettings = {
  requestKey: string;
  agentKind: AgentKind;
  model?: string;
  effort?: string;
};

export type CreateThreadInput =
  | (CreateThreadSettings & {
      scope: "freeform";
    })
  | (CreateThreadSettings & {
      scope: "project_session";
      projectSlug: string;
      workspacePath?: string;
    })
  | (CreateThreadSettings & {
      scope: "issue_session";
      projectSlug: string;
      issueIdentifier: string;
      workspacePath?: string;
      isolatedWorkspace?: boolean;
      useParentWorkspace?: boolean;
      cloneBranch?: string;
    });

export type TrackerClient = {
  health(signal?: AbortSignal): Promise<Health>;
  viewer(signal?: AbortSignal): Promise<Viewer>;
  projects(signal?: AbortSignal): Promise<ProjectSummary[]>;
  threads(options?: ThreadListOptions, signal?: AbortSignal): Promise<AssistantThread[]>;
  projectSessions(
    projectSlug: string,
    options?: ProjectSessionListOptions,
    signal?: AbortSignal,
  ): Promise<ProjectSessionsPage>;
  assistantCatalog(projectSlug: string, signal?: AbortSignal): Promise<AssistantCatalog>;
  createThread(input: CreateThreadInput, signal?: AbortSignal): Promise<AssistantThread>;
};
