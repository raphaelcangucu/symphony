export type WorkspaceInventoryKind = "issue" | "issue_parallel" | "project" | "standalone" | "unknown";

export type WorkspaceClassification = "active" | "orphan";

export interface WorkspaceRepoState {
  name: string;
  path: string;
  branch: string | null;
  defaultBranch: string | null;
  dirty: boolean;
  upstream: boolean;
  aheadCount: number;
  sizeBytes: number;
}

export interface WorkspaceChildWorktree {
  path: string;
  repoName: string;
  slug: string;
  branch: string | null;
  dirty: boolean;
  sizeBytes: number;
}

export interface WorkspaceInventoryEntry {
  path: string;
  kind: WorkspaceInventoryKind;
  issueIdentifier: string | null;
  name: string | null;
  classification: WorkspaceClassification;
  reclaimable: boolean;
  workPresent: boolean;
  executionStatus: string | null;
  removable: boolean;
  sizeBytes: number;
  repos: WorkspaceRepoState[];
  childWorktrees: WorkspaceChildWorktree[];
}

export interface WorkspaceInventoryTotals {
  count: number;
  sizeBytes: number;
  reclaimableBytes: number;
}

export interface WorkspaceInventory {
  entries: WorkspaceInventoryEntry[];
  totals: WorkspaceInventoryTotals;
}

export interface WorkspaceRemovalResult {
  path: string;
  status: "removed" | "skipped";
  reason: string | null;
}
