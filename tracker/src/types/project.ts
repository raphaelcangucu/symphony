import type { WorkflowStatus } from "./workflow-status";
import type { ProjectSetup } from "./project-setup";
import type { WorkspaceRepository } from "./repository";

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  issueCount?: number;
  workflowStatuses?: WorkflowStatus[];
  repositories?: WorkspaceRepository[];
  setup?: ProjectSetup | null;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
}
