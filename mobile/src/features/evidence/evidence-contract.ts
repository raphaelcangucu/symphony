export type EvidenceArtifactKind = "image" | "video" | "report" | "trace";

export type EvidenceArtifact = {
  kind: EvidenceArtifactKind;
  path: string;
  label: string;
  navigations: string[];
};

export type EvidenceRun = {
  kind: string;
  repo: string;
  command: string;
  status: string;
  taskId: string | null;
  taskTitle: string | null;
  durationMs: number | null;
  blockedReason: string | null;
  summary: Record<string, unknown> | null;
  proof: Record<string, unknown>;
  artifacts: EvidenceArtifact[];
};

export type EvidenceManifest = {
  issue: string | null;
  generatedAt: string | null;
  uiChange: boolean;
  runs: EvidenceRun[];
};

export type EvidenceRecord = {
  id: number | null;
  runId: string;
  sessionId: string | null;
  status: string;
  uiChange: boolean;
  insertedAt: string | null;
  manifest: EvidenceManifest;
};

export function normalizeEvidenceRecords(payload: unknown): EvidenceRecord[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.records)
      ? payload.records
      : [];

  return rows.flatMap((row) => {
    const record = normalizeEvidenceRecord(row);
    return record ? [record] : [];
  });
}

function normalizeEvidenceRecord(value: unknown): EvidenceRecord | null {
  if (!isRecord(value) || !isRecord(value.manifest)) return null;
  const runId = nonEmptyString(value.run_id);
  const status = nonEmptyString(value.status);
  if (!runId || !status) return null;

  const manifest = value.manifest;
  const runs = Array.isArray(manifest.runs)
    ? manifest.runs.flatMap((run) => {
        const normalized = normalizeRun(run);
        return normalized ? [normalized] : [];
      })
    : [];

  return {
    id: positiveInteger(value.id),
    runId,
    sessionId: nonEmptyString(value.session_id),
    status,
    uiChange: value.ui_change === true,
    insertedAt: nonEmptyString(value.inserted_at),
    manifest: {
      issue: nonEmptyString(manifest.issue),
      generatedAt: nonEmptyString(manifest.generated_at),
      uiChange: manifest.ui_change === true,
      runs,
    },
  };
}

function normalizeRun(value: unknown): EvidenceRun | null {
  if (!isRecord(value)) return null;
  const kind = nonEmptyString(value.kind);
  const repo = nonEmptyString(value.repo);
  const command = nonEmptyString(value.command);
  const status = nonEmptyString(value.status);
  if (!kind || !repo || !command || !status) return null;

  return {
    kind,
    repo,
    command,
    status,
    taskId: nonEmptyString(value.task_id),
    taskTitle: nonEmptyString(value.task_title),
    durationMs: nonNegativeNumber(value.duration_ms),
    blockedReason: nonEmptyString(value.blocked_reason),
    summary: isRecord(value.summary) ? value.summary : null,
    proof: isRecord(value.proof) ? value.proof : {},
    artifacts: [
      ...artifactList(value.report, "report"),
      ...artifactList(value.screenshots, "image"),
      ...artifactList(value.videos, "video"),
      ...artifactList(value.trace, "trace"),
    ],
  };
}

function artifactList(value: unknown, kind: EvidenceArtifactKind): EvidenceArtifact[] {
  const entries = Array.isArray(value) ? value : value == null ? [] : [value];

  return entries.flatMap((entry) => {
    const artifact = normalizeArtifact(entry, kind);
    return artifact ? [artifact] : [];
  });
}

function normalizeArtifact(value: unknown, kind: EvidenceArtifactKind): EvidenceArtifact | null {
  const path = nonEmptyString(isRecord(value) ? value.path : value);
  if (!path) return null;

  return {
    kind,
    path,
    label: nonEmptyString(isRecord(value) ? value.label : null) ?? pathLabel(path),
    navigations:
      isRecord(value) && Array.isArray(value.navigations)
        ? value.navigations.flatMap((item) => {
            const navigation = nonEmptyString(item);
            return navigation ? [navigation] : [];
          })
        : [],
  };
}

function pathLabel(path: string): string {
  const basename = path.split("/").filter(Boolean).at(-1) ?? path;
  return basename.replace(/\.[^.]+$/, "") || basename;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
