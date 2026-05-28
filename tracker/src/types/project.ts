import type { WorkflowStatus } from "./workflow-status";

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  issueCount?: number;
  workflowStatuses?: WorkflowStatus[];
  createdAt?: string;
  updatedAt?: string;
}
