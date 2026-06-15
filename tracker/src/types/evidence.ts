export interface EvidenceRunSummary {
  total?: number;
  passed?: number;
  failed?: number;
  reason?: string;
}

export interface EvidenceRun {
  kind: "unit" | "e2e" | string;
  repo: string;
  command: string;
  status: "passed" | "failed" | string;
  summary?: EvidenceRunSummary | null;
  report?: string | null;
  screenshots?: string[];
  videos?: string[];
  trace?: string | null;
  duration_ms?: number | null;
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
