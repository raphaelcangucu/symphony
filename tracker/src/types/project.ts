import type { WorkflowStatus } from "./workflow-status";
import type { ProjectSetup } from "./project-setup";
import type { WorkspaceRepository } from "./repository";

export type TrackerKind = "local" | "github" | "linear" | "jira";

export interface ProjectTrackerConfig {
  kind: TrackerKind;
  config: Record<string, unknown>;
}

export type ProjectSyncStatus = "idle" | "syncing" | "error";

export interface ProjectSyncState {
  status: ProjectSyncStatus;
  lastError: string | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastFullSyncAt: string | null;
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
  syncState?: ProjectSyncState | null;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string | null;
  archivedAt?: string | null;
  warmUpStatus?: "never" | "running" | "succeeded" | "failed";
  warmedAt?: string | null;
  lastWarmUpRunId?: number | null;
}
