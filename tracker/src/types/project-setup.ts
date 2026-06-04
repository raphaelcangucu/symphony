import type { WorkspaceRepository, RepositoryScan } from "./repository";
import type { WorkflowStatus } from "./workflow-status";

export interface WorkspaceSuggestion {
  workflowStatuses: WorkflowStatus[];
  workflowMarkdown: string;
  validationCommands: string[];
  afterCreateHook: string;
  scanSummary: Record<string, unknown>;
}

export interface WorkspaceSuggestionInput {
  repositories: WorkspaceRepository[];
  scans: RepositoryScan[];
}

export interface ProjectSetup {
  id?: string;
  workflowMarkdown?: string | null;
  afterCreateHook?: string | null;
  validationCommands: string[];
  scanSummary?: Record<string, unknown>;
}
