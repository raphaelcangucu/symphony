import {
  normalizeEvidenceRecords,
  type EvidenceRecord,
} from "@/features/evidence/evidence-contract";

export const COMPARISON_CELLS = [
  {
    id: "session-codex",
    path: "session",
    provider: "codex",
    requestedModel: "gpt-5.6-sol",
    requestedEffort: "high",
  },
  {
    id: "session-cursor",
    path: "session",
    provider: "cursor",
    requestedModel: "cursor-grok-4.5-high",
    requestedEffort: null,
  },
  {
    id: "session-claude",
    path: "session",
    provider: "claude",
    requestedModel: "claude-opus-5",
    requestedEffort: "high",
  },
  {
    id: "orchestrator-codex",
    path: "orchestrator",
    provider: "codex",
    requestedModel: "gpt-5.6-sol",
    requestedEffort: "high",
  },
  {
    id: "orchestrator-cursor",
    path: "orchestrator",
    provider: "cursor",
    requestedModel: "cursor-grok-4.5-high",
    requestedEffort: null,
  },
  {
    id: "orchestrator-claude",
    path: "orchestrator",
    provider: "claude",
    requestedModel: "claude-opus-5",
    requestedEffort: "high",
  },
] as const;

export type ComparisonCellId = (typeof COMPARISON_CELLS)[number]["id"];
export type ComparisonPath = (typeof COMPARISON_CELLS)[number]["path"];
export type ComparisonProvider = (typeof COMPARISON_CELLS)[number]["provider"];

export type ComparisonPreview = {
  id: string | null;
  status: string | null;
  url: string | null;
  port: number | null;
};

export type ComparisonCell = {
  id: ComparisonCellId;
  path: ComparisonPath;
  provider: ComparisonProvider;
  requestedModel: string;
  requestedEffort: string | null;
  effectiveEffort: "high";
  resolvedModel: string | null;
  resolvedEffort: string | null;
  status: string;
  attempt: number;
  issueIdentifier: string | null;
  threadId: number | null;
  executionSessionId: number | null;
  latestMessage: string | null;
  error: string | null;
  previews: ComparisonPreview[];
  evidence: EvidenceRecord[];
};

export type ComparisonProgress = {
  terminal: number;
  passed: number;
  failed: number;
  total: number;
};

export type ComparisonSnapshot = {
  projectSlug: string;
  identifier: string;
  title: string | null;
  status: "running" | "completed";
  progress: ComparisonProgress;
  cells: ComparisonCell[];
  decision: Record<string, unknown> | null;
};

const terminalStatuses = new Set([
  "passed",
  "failed",
  "blocked",
  "saved",
  "completed",
  "error",
  "cancelled",
  "canceled",
]);
const passedStatuses = new Set(["passed", "saved", "completed"]);
const failedStatuses = new Set(["failed", "blocked", "error", "cancelled", "canceled"]);

export function normalizeComparisonSnapshot(payload: unknown): ComparisonSnapshot | null {
  if (!isRecord(payload)) return null;
  const projectSlug = nonEmptyString(payload.project_slug);
  const identifier = nonEmptyString(payload.identifier);
  if (!projectSlug || !identifier) return null;

  const rows = Array.isArray(payload.cells) ? payload.cells : [];
  const byId = new Map<ComparisonCellId, ComparisonCell>();

  for (const row of rows) {
    const cell = normalizeCell(row);
    if (cell && !byId.has(cell.id)) byId.set(cell.id, cell);
  }

  const cells = COMPARISON_CELLS.flatMap((contract) => {
    const cell = byId.get(contract.id);
    return cell ? [cell] : [];
  });
  const progress = progressFor(cells);

  return {
    projectSlug,
    identifier,
    title: nonEmptyString(payload.title),
    status:
      cells.length === COMPARISON_CELLS.length && progress.terminal === cells.length
        ? "completed"
        : "running",
    progress,
    cells,
    decision: isRecord(payload.decision) ? payload.decision : null,
  };
}

export function canRetryComparisonCell(cell: ComparisonCell): boolean {
  return failedStatuses.has(cell.status);
}

function normalizeCell(value: unknown): ComparisonCell | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const contract = COMPARISON_CELLS.find((candidate) => candidate.id === id);
  const status = nonEmptyString(value.status);
  if (
    !contract ||
    !status ||
    value.path !== contract.path ||
    value.provider !== contract.provider ||
    value.requested_model !== contract.requestedModel ||
    value.requested_effort !== contract.requestedEffort
  ) {
    return null;
  }

  return {
    id: contract.id,
    path: contract.path,
    provider: contract.provider,
    requestedModel: contract.requestedModel,
    requestedEffort: contract.requestedEffort,
    effectiveEffort: "high",
    resolvedModel: nonEmptyString(value.resolved_model),
    resolvedEffort: nonEmptyString(value.resolved_effort),
    status,
    attempt: positiveInteger(value.attempt) ?? 1,
    issueIdentifier: nonEmptyString(value.issue_identifier),
    threadId: positiveInteger(value.thread_id),
    executionSessionId: positiveInteger(value.execution_session_id),
    latestMessage: nonEmptyString(value.latest_message),
    error: nonEmptyString(value.error),
    previews: normalizePreviews(value.previews),
    evidence: normalizeEvidenceRecords(value.evidence),
  };
}

function progressFor(cells: ComparisonCell[]): ComparisonProgress {
  return {
    terminal: cells.filter((cell) => terminalStatuses.has(cell.status)).length,
    passed: cells.filter((cell) => passedStatuses.has(cell.status)).length,
    failed: cells.filter((cell) => failedStatuses.has(cell.status)).length,
    total: cells.length,
  };
}

function normalizePreviews(value: unknown): ComparisonPreview[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [
      {
        id: nonEmptyString(entry.id),
        status: nonEmptyString(entry.status),
        url: nonEmptyString(entry.url),
        port: positiveInteger(entry.port),
      },
    ];
  });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
