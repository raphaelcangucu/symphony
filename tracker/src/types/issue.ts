import type { BlockerSummary } from "./blocker";
import type { WorkflowStatusName } from "./workflow-status";

export type IssuePriority = 0 | 1 | 2 | 3 | 4;

export interface IssueLabel {
  id?: string;
  name: string;
  color?: string | null;
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
}

export type AgentKind = "codex" | "claude";

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
}

export interface CreateIssueInput {
  title: string;
  description?: string | null;
  status: WorkflowStatusName;
  priority?: IssuePriority | null;
  labelIds?: string[];
  assigneeIds?: string[];
  agent?: AgentKind | null;
}

export interface MoveIssueInput {
  status: WorkflowStatusName;
  position: number;
}
