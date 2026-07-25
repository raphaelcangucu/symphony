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

export type IssuePriority = 0 | 1 | 2 | 3 | 4;

export type IssueSummary = {
  id: string;
  identifier: string;
  displayIdentifier: string;
  projectSlug: string;
  title: string;
  description: string | null;
  status: string;
  priority: IssuePriority | null;
  position: number;
  labels: string[];
  assignee: string | null;
  creator: string | null;
  agentKind: AgentKind | null;
  agentGoal: string | null;
  branchName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssueListOptions = {
  query?: string;
  assignee?: string;
  creator?: string;
};

export type IssueMutationInput = {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: IssuePriority | null;
  labelIds?: string[];
  assigneeIds?: string[];
  agent?: AgentKind | null;
  goal?: string | null;
  model?: string | null;
  effort?: string | null;
};

export type CreateIssueInput = IssueMutationInput & {
  title: string;
  status: string;
};

export type IssueComment = {
  id: string;
  body: string;
  author: string | null;
  kind: string;
  createdAt: string;
  updatedAt: string;
};

export type IssueFormOptions = {
  statuses: string[];
  labels: Array<{ id: string | null; name: string; color: string | null }>;
  assignees: Array<{
    id: string | null;
    login: string | null;
    name: string | null;
  }>;
  agents: Array<{ value: AgentKind; label: string; default: boolean }>;
  effectiveAgent: AgentKind;
};

export type IssueBlocker = {
  identifier: string;
  title: string;
  status: string | null;
  relationType: string;
};

export type IssueDispatchInput = {
  action: "resume" | "hard_reset" | "stop" | "continue_work";
  agent?: AgentKind;
  goal?: string;
  instructions?: string;
  targetStatus?: string;
  model?: string;
  effort?: string;
  mode?: "plan" | "build" | "yolo";
};

export type IssueDispatchResult = {
  action: IssueDispatchInput["action"];
  message: string;
  issue: IssueSummary;
};

export type GoalControlInput = {
  action: "get" | "pause" | "resume" | "clear" | "set_objective" | "set_budget";
  objective?: string;
  tokenBudget?: number;
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
  issues(
    projectSlug: string,
    options?: IssueListOptions,
    signal?: AbortSignal,
  ): Promise<IssueSummary[]>;
  issue(projectSlug: string, identifier: string, signal?: AbortSignal): Promise<IssueSummary>;
  issueFormOptions(projectSlug: string, signal?: AbortSignal): Promise<IssueFormOptions>;
  createIssue(
    projectSlug: string,
    input: CreateIssueInput,
    signal?: AbortSignal,
  ): Promise<IssueSummary>;
  updateIssue(
    projectSlug: string,
    identifier: string,
    input: IssueMutationInput,
    signal?: AbortSignal,
  ): Promise<IssueSummary>;
  comments(projectSlug: string, identifier: string, signal?: AbortSignal): Promise<IssueComment[]>;
  createComment(
    projectSlug: string,
    identifier: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<IssueComment>;
  blockers(projectSlug: string, identifier: string, signal?: AbortSignal): Promise<IssueBlocker[]>;
  dispatchIssue(
    projectSlug: string,
    identifier: string,
    input: IssueDispatchInput,
    signal?: AbortSignal,
  ): Promise<IssueDispatchResult>;
  goalControl(
    projectSlug: string,
    identifier: string,
    input: GoalControlInput,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
};
