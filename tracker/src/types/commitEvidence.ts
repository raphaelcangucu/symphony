export interface CommitEvidenceSummary {
  repo: string;
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authoredAt: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  online: boolean;
}

export interface CommitFileChange {
  path: string;
  oldPath: string | null;
  status: string;
  patch: string;
}

export interface CommitEvidenceDetail extends CommitEvidenceSummary {
  files: CommitFileChange[];
}

export interface CommitEvidenceWorkspace {
  path: string;
  available: boolean;
}

export interface CommitEvidencePage {
  commits: CommitEvidenceSummary[];
  total: number;
  limit: number;
  nextCursor: string | null;
  workspace: CommitEvidenceWorkspace;
}
