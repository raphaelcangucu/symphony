import type { WorkflowStatus } from "./workflow-status";
import type { ProjectSetup } from "./project-setup";
import type { WorkspaceRepository } from "./repository";

export type TrackerKind = "local" | "github" | "linear" | "jira";

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
  trackerUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
}
