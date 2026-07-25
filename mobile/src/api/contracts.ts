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

export type ThreadDocument = {
  id: string;
  kind: "draft";
  path: string;
  title: string;
  updatedAt: string | null;
};

export type ThreadDocumentList = {
  available: boolean;
  reason: string | null;
  documents: ThreadDocument[];
};

export type ThreadDocumentContent = {
  path: string;
  content: string;
};

export type DevServer = {
  id: number;
  slug: string;
  url: string | null;
  localUrl: string | null;
  publicUrl: string | null;
  status: string;
  primary: boolean;
};

export type DevServerList = {
  available: boolean;
  reason: string | null;
  servers: DevServer[];
};

export type GitDiffType = "branch" | "uncommitted";

export type GitDiffWorkspace = {
  path: string;
  available: boolean;
};

export type GitDiffRepoStat = {
  repo: string;
  branch: string | null;
  base: string | null;
  filesChanged: number;
  additions: number;
  deletions: number;
  untracked: number;
};

export type GitDiffStatsResult = {
  stats: GitDiffRepoStat[];
  workspace: GitDiffWorkspace;
};

export type GitDiffFileEntry = {
  repo: string;
  path: string;
  oldPath: string | null;
  status: string;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
};

export type GitDiffFilesOptions = {
  type?: GitDiffType;
  repo?: string;
  query?: string;
  limit?: number;
  cursor?: string;
};

export type GitDiffFilesPage = {
  files: GitDiffFileEntry[];
  total: number;
  limit: number;
  nextCursor: string | null;
  workspace: GitDiffWorkspace;
};

export type GitDiffPatchOptions = {
  type?: GitDiffType;
  repo: string;
  path: string;
};

export type GitDiffPatchResult = {
  repo: string;
  path: string;
  status: string;
  binary: boolean;
  truncated: boolean;
  patch: string;
  workspace: GitDiffWorkspace;
};

export type GitDiffCommitResult = {
  repo: string;
  sha: string;
  message: string;
  files: string[];
};

export type GitDiffCommitResponse = {
  commits: GitDiffCommitResult[];
  workspace: GitDiffWorkspace;
};

export type GitDiffPushResult = {
  repo: string;
  ok: boolean;
  error?: string;
};

export type GitDiffPushResponse = {
  results: GitDiffPushResult[];
  workspace: GitDiffWorkspace;
};

export type PullRequestState = "open" | "closed" | "merged" | "draft" | "unknown";
export type PullRequestMergeMethod = "merge" | "squash" | "rebase";

export type PullRequestJob = {
  name: string | null;
  status: string | null;
  conclusion: string | null;
  url: string | null;
};

export type PullRequestPipeline = {
  name: string;
  url: string | null;
  jobs: PullRequestJob[];
};

export type PullRequestStatus = {
  context: string | null;
  state: string | null;
  url: string | null;
  description: string | null;
};

export type PullRequestConversationEntry = {
  author: string | null;
  body: string;
  kind: "comment" | "review";
  reviewState: string | null;
  createdAt: string | null;
};

export type PullRequest = {
  number: number;
  title: string | null;
  url: string | null;
  state: PullRequestState;
  repo: string | null;
  origin: "auto" | "manual";
  isDraft: boolean;
  merged: boolean;
  headRef: string | null;
  baseRef: string | null;
  author: string | null;
  mergeable: string | null;
  checksState: string | null;
  pipelines: PullRequestPipeline[];
  statuses: PullRequestStatus[];
  conversation: PullRequestConversationEntry[];
  baseBehindBy: number | null;
};

export type PullRequestGroup = {
  identifier: string;
  title: string | null;
  pullRequests: PullRequest[];
};

export type PullRequestResult = {
  pullRequests: PullRequest[];
  supported: boolean;
  available: boolean;
  children: PullRequestGroup[];
};

export type PullRequestFixResult = {
  movedTo: string;
  commentPosted: boolean;
  jobs: Array<{ name: string | null; conclusion: string | null; url: string | null }>;
};

export type PullRequestRerunResult = {
  runId: number;
  ok: boolean;
  error?: string;
  status?: number;
};

export type MergePullRequestInput = {
  method: PullRequestMergeMethod;
  bypass?: boolean;
};

export type MergePullRequestResult = {
  merged: boolean;
  method: PullRequestMergeMethod;
  bypass: boolean;
  sha?: string;
  message?: string;
  issue: IssueSummary | null;
};

export type MobilePushIdentity = {
  profileId: string;
  deviceId: string;
};

export type MobilePushRegistrationInput = MobilePushIdentity & {
  platform: "android" | "ios";
  token: string;
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
  threadDocuments(threadId: number, signal?: AbortSignal): Promise<ThreadDocumentList>;
  threadDocument(
    threadId: number,
    path: string,
    signal?: AbortSignal,
  ): Promise<ThreadDocumentContent>;
  threadDevServers(threadId: number, signal?: AbortSignal): Promise<DevServerList>;
  startThreadDevServers(threadId: number, signal?: AbortSignal): Promise<DevServerList>;
  restartThreadDevServers(threadId: number, signal?: AbortSignal): Promise<DevServerList>;
  threadDiffStats(
    threadId: number,
    type?: GitDiffType,
    signal?: AbortSignal,
  ): Promise<GitDiffStatsResult>;
  threadDiffFiles(
    threadId: number,
    options?: GitDiffFilesOptions,
    signal?: AbortSignal,
  ): Promise<GitDiffFilesPage>;
  threadDiffPatch(
    threadId: number,
    options: GitDiffPatchOptions,
    signal?: AbortSignal,
  ): Promise<GitDiffPatchResult>;
  commitThreadDiff(
    threadId: number,
    message: string,
    signal?: AbortSignal,
  ): Promise<GitDiffCommitResponse>;
  pushThreadDiff(threadId: number, signal?: AbortSignal): Promise<GitDiffPushResponse>;
  issuePullRequests(
    projectSlug: string,
    identifier: string,
    refresh?: boolean,
    signal?: AbortSignal,
  ): Promise<PullRequestResult>;
  linkIssuePullRequest(
    projectSlug: string,
    identifier: string,
    url: string,
    signal?: AbortSignal,
  ): Promise<void>;
  unlinkIssuePullRequest(
    projectSlug: string,
    identifier: string,
    url: string,
    signal?: AbortSignal,
  ): Promise<void>;
  requestPullRequestFix(
    projectSlug: string,
    identifier: string,
    signal?: AbortSignal,
  ): Promise<PullRequestFixResult>;
  updatePullRequestBranch(
    projectSlug: string,
    identifier: string,
    number: number,
    signal?: AbortSignal,
  ): Promise<{ updated: boolean }>;
  rerunPullRequestJobs(
    projectSlug: string,
    identifier: string,
    number: number,
    signal?: AbortSignal,
  ): Promise<PullRequestRerunResult[]>;
  mergeIssuePullRequest(
    projectSlug: string,
    identifier: string,
    number: number,
    input: MergePullRequestInput,
    signal?: AbortSignal,
  ): Promise<MergePullRequestResult>;
  registerMobilePush(
    input: MobilePushRegistrationInput,
    signal?: AbortSignal,
  ): Promise<{ registered: boolean; deviceId: string }>;
  unregisterMobilePush(
    input: MobilePushIdentity,
    signal?: AbortSignal,
  ): Promise<{ deleted: boolean }>;
  sendTestMobilePush(signal?: AbortSignal): Promise<{ sent: boolean; deviceCount: number }>;
};
