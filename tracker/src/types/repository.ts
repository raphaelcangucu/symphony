export interface WorkspaceRepository {
  id?: string;
  name?: string | null;
  fullName: string;
  description?: string | null;
  url?: string | null;
  cloneUrl?: string | null;
  sshUrl?: string | null;
  defaultBranch?: string | null;
  selectedBranch?: string | null;
  private?: boolean;
  avatarUrl?: string | null;
  suggestedLocalPath?: string | null;
  localPath?: string | null;
  workspacePath: string;
  role: string;
  scanSummary?: Record<string, unknown>;
}

export interface GitHubOwner {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
  kind: "user" | "organization";
}

export interface RepositoryScanRequest {
  localPath: string;
  workspacePath: string;
}

export interface RepositoryScan {
  localPath?: string | null;
  workspacePath: string;
  stack: string[];
  packageManager?: string | null;
  scripts?: string[];
  agentInstructionFiles?: string[];
  validationCommands: string[];
  error?: string | null;
}
