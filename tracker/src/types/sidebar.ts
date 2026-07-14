import type { AgentExecution } from "@/types/agent-execution";
import type { AssistantThread } from "@/types/assistant-thread";
import type { AgentKind, Issue } from "@/types/issue";
import type { RecentSession, RecentStatusKind } from "@/types/recents";
import type { WorkspaceInventoryEntry } from "@/types/worktrees";

export type SidebarLoadState = "idle" | "loading" | "ready" | "error" | "stale";
export type SidebarAggregateStatus = "idle" | "active" | "attention" | "error" | "stale";
export type SidebarWorkspaceKind = "project" | "issue" | "standalone" | "parallel" | "orphan";
export type SidebarSessionKind = "chat" | "authoring" | "execution";
export type SidebarSortMode = "activity" | "name";

export interface SidebarSessionNode {
  kind: "session";
  id: string;
  projectSlug: string;
  workspaceId: string | null;
  sessionKind: SidebarSessionKind;
  title: string;
  subtitle: string;
  href: string;
  statusKind: RecentStatusKind;
  aggregateStatus: SidebarAggregateStatus;
  agentKind: RecentSession["agentKind"];
  updatedAt: string;
  threadId: number | null;
  issueIdentifier: string | null;
  archived: boolean;
  unread: boolean;
  needsReview: boolean;
  labels: readonly string[] | null;
  issueLabelNames: readonly string[] | null;
  pinned: boolean;
}

export interface SidebarWorkspaceNode {
  kind: "workspace";
  id: string;
  projectSlug: string;
  workspaceKind: SidebarWorkspaceKind;
  title: string;
  subtitle: string;
  href: string;
  branchSummary: string | null;
  aggregateStatus: SidebarAggregateStatus;
  updatedAt: string;
  inventory: WorkspaceInventoryEntry | null;
  issueIdentifier: string | null;
  sessions: readonly SidebarSessionNode[];
  overflowSessions: readonly SidebarSessionNode[];
  pinned: boolean;
}

export interface SidebarProjectNode {
  kind: "project";
  id: string;
  projectSlug: string;
  title: string;
  subtitle: string;
  href: string;
  archived: boolean;
  aggregateStatus: SidebarAggregateStatus;
  updatedAt: string;
  loadState: SidebarLoadState;
  error: string | null;
  workspaces: readonly SidebarWorkspaceNode[];
  overflowWorkspaces: readonly SidebarWorkspaceNode[];
  unassignedSessions: readonly SidebarSessionNode[];
  pinned: boolean;
}

export type SidebarNode = SidebarProjectNode | SidebarWorkspaceNode | SidebarSessionNode;

export type SidebarMenuActionId =
  | "new-workspace"
  | "new-session"
  | "open-board"
  | "open-docs"
  | "open-settings"
  | "open-editor"
  | "open-terminal"
  | "pin"
  | "unpin"
  | "rename"
  | "copy-branch"
  | "copy-path"
  | "manage-labels"
  | "toggle-review"
  | "copy-resume-link"
  | "archive"
  | "restore"
  | "remove"
  | "remove-workspace"
  | "delete";

export interface SidebarMenuAction {
  readonly id: SidebarMenuActionId;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly destructive?: boolean;
}

export interface SidebarIssueCapabilities {
  readonly canRename: boolean;
  readonly canManageLabels: boolean;
}

export interface SidebarThreadCapabilities {
  readonly canRename: boolean;
  readonly canManageLabels: boolean;
  readonly canReview: boolean;
  readonly canArchive: boolean;
  readonly canDelete: boolean;
  readonly local: boolean;
  readonly active: boolean;
  readonly closed: boolean;
}

export interface SidebarCapabilityContext {
  readonly editorTarget: string | null;
  readonly terminalTarget: string | null;
  readonly workspacePath: string | null;
  readonly branchName: string | null;
  readonly workspaceRemovable: boolean;
  readonly issueCapabilities: SidebarIssueCapabilities | null;
  readonly threadCapabilities: SidebarThreadCapabilities | null;
}

export interface SidebarTreeBuildOptions {
  pinnedProjectIds: ReadonlySet<string>;
  pinnedWorkspaceIds: ReadonlySet<string>;
  pinnedSessionIds: ReadonlySet<string>;
  lastReadAtBySession: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  sortMode: SidebarSortMode;
  workspaceLimit?: number;
  sessionLimit?: number;
}

export interface SidebarProjectBranchInput {
  projectSlug: string;
  projectTitle: string;
  archived: boolean;
  issues: readonly Issue[];
  executions: ReadonlyMap<string, AgentExecution> | Iterable<AgentExecution>;
  relatedSessions: readonly RecentSession[];
  assistantThreads: readonly AssistantThread[];
  inventory: readonly WorkspaceInventoryEntry[];
  loadState: SidebarLoadState;
  error: string | null;
  options: SidebarTreeBuildOptions;
}

export interface SidebarSortableNode {
  id: string;
  title: string;
  pinned: boolean;
  aggregateStatus: SidebarAggregateStatus;
  updatedAt: string;
}

export interface SidebarVisiblePartition<T> {
  visible: readonly T[];
  overflow: readonly T[];
}

export type SidebarAgentKind = AgentKind | null;
