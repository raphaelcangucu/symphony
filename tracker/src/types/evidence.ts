export interface EvidenceRunSummary {
  total?: number;
  passed?: number;
  failed?: number;
  reason?: string;
}

export interface EvidenceArtifactRef {
  path: string;
  label?: string | null;
  navigations?: string[];
}

export interface EvidenceRun {
  kind: "unit" | "e2e" | string;
  repo: string;
  command: string;
  status: "passed" | "failed" | string;
  task_id?: string | null;
  task_title?: string | null;
  summary?: EvidenceRunSummary | null;
  report?: string | null;
  screenshots?: EvidenceArtifactRef[];
  videos?: EvidenceArtifactRef[];
  trace?: string | null;
  duration_ms?: number | null;
  blocked_reason?: string | null;
  navigations?: string[];
  proof?: Record<string, unknown> | null;
}

export interface EvidenceRecord {
  id: number;
  runId: string;
  sessionId: string | null;
  status: string;
  uiChange: boolean;
  runs: EvidenceRun[];
  insertedAt: string;
}
