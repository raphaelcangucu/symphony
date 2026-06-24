import type { BlockerSummary } from "./blocker";
import type { WorkflowStatusName } from "./workflow-status";

export type IssuePriority = 0 | 1 | 2 | 3 | 4;

export type IssueDevServerStatus =
  | "pending"
  | "provisioning"
  | "starting"
  | "ready"
  | "crashed"
  | "stopped";

export type IssueDevServerReason =
  | "disabled"
  | "workspace_missing"
  | "no_serve_step"
  | "no_free_port"
  | "lock_unavailable"
  | "start_failed"
  | "restart_failed"
  | "crashed"
  | null;

export interface IssueDevServer {
  id: number;
  slug: string;
  working_dir: string | null;
  port: number | null;
  url: string | null;
  status: IssueDevServerStatus;
  primary: boolean;
  session_name: string | null;
}

export interface IssueDevServerTunnel {
  enabled: boolean;
  running: boolean;
}

export interface IssueDevServersResponse {
  available: boolean;
  reason: IssueDevServerReason;
  servers: IssueDevServer[];
  tunnel?: IssueDevServerTunnel;
}

export interface IssueLabel {
  id?: string;
  name: string;
  color?: string | null;
}

export interface IssueAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string | null;
  author: string | null;
  isImage: boolean;
}

export interface Issue {
  id: string;
  identifier: string;
  projectSlug: string;
  status: WorkflowStatusName;
  title: string;
  description: string | null;
  priority: IssuePriority | null;
  position: number;
  labels: string[];
  blockedBy: BlockerSummary[];
  assignee: string | null;
  creator: string | null;
  url: string | null;
  branchName: string | null;
  createdAt: string;
  updatedAt: string;
  agentKind?: AgentKind | null;
  agentGoal?: string | null;
  attachments: IssueAttachment[];
  groupLeadIdentifier: string | null;
  groupMemberIdentifiers: string[];
  repositoryFullName: string | null;
  parentIdentifier: string | null;
  subIssueSummary: { total: number; completed: number; percentCompleted: number } | null;
}

export const AGENT_KINDS = ["codex", "claude", "cursor"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export interface IssueLabelOption {
  id: string | null;
  name: string;
  color: string | null;
}

export interface IssueAssigneeOption {
  id: string | null;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface AgentOption {
  value: AgentKind;
  label: string;
  default: boolean;
}

export interface IssueFormOptions {
  labels: IssueLabelOption[];
  assignees: IssueAssigneeOption[];
  statuses: WorkflowStatusName[];
  agents: AgentOption[];
  effectiveAgent: AgentKind;
}

export interface CreateIssueInput {
  title: string;
  description?: string | null;
  status: WorkflowStatusName;
  priority?: IssuePriority | null;
  labelIds?: string[];
  assigneeIds?: string[];
  agent?: AgentKind | null;
  goal?: string | null;
}

export interface MoveIssueInput {
  status: WorkflowStatusName;
  position: number;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string | null;
  labelIds?: string[];
  priority?: IssuePriority | null;
  assigneeIds?: string[];
  agent?: AgentKind | null;
}
