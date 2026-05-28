import type { WorkspaceRepository, RepositoryScan } from "./repository";
import type { WorkflowStatus } from "./workflow-status";

export interface WorkspaceSuggestion {
  workflowStatuses: WorkflowStatus[];
  workflowConfig: Record<string, unknown>;
  validationCommands: string[];
  afterCreateHook: string;
  promptTemplate: string;
  scanSummary: Record<string, unknown>;
}

export interface WorkspaceSuggestionInput {
  repositories: WorkspaceRepository[];
  scans: RepositoryScan[];
}

export interface ProjectSetup {
  id?: string;
  workflowConfig?: Record<string, unknown>;
  afterCreateHook?: string | null;
  promptTemplate?: string | null;
  validationCommands: string[];
  scanSummary?: Record<string, unknown>;
}
