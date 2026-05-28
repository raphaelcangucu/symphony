import type { WorkflowStatus } from "./workflow-status";
import type { ProjectSetup } from "./project-setup";
import type { WorkspaceRepository } from "./repository";

export type TrackerKind = "local" | "github" | "linear";

export interface ProjectTrackerConfig {
  kind: TrackerKind;
  config: Record<string, unknown>;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  issueCount?: number;
  workflowStatuses?: WorkflowStatus[];
  repositories?: WorkspaceRepository[];
  setup?: ProjectSetup | null;
  tracker: ProjectTrackerConfig;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
}
