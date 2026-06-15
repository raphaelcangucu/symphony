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
