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
  createdAt: string;
  updatedAt: string;
}

export interface CreateIssueInput {
  title: string;
  description?: string | null;
  status: WorkflowStatusName;
  priority?: IssuePriority | null;
}

export interface MoveIssueInput {
  status: WorkflowStatusName;
  position: number;
}
