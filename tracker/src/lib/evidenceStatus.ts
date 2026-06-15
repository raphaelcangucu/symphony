import type { EvidenceRecord, EvidenceRun } from "@/types/evidence";

export type EvidenceAttentionKind = "none" | "missing" | "failed";

export interface EvidenceAttention {
  kind: EvidenceAttentionKind;
  latestRecord: EvidenceRecord | null;
  failedRuns: EvidenceRun[];
}

export function assessEvidenceAttention(records: EvidenceRecord[]): EvidenceAttention {
  if (records.length === 0) {
    return { kind: "missing", latestRecord: null, failedRuns: [] };
  }

  const latestRecord = records[0];
  const failedRuns = latestRecord.runs.filter((run) => run.status !== "passed");

  if (latestRecord.status !== "passed" || failedRuns.length > 0) {
    return { kind: "failed", latestRecord, failedRuns };
  }

  return { kind: "none", latestRecord, failedRuns: [] };
}

export function evidenceNeedsAttention(records: EvidenceRecord[]): boolean {
  return assessEvidenceAttention(records).kind !== "none";
}

function runFailureDetail(run: EvidenceRun): string {
  const summary = run.summary;
  if (summary && typeof summary === "object" && "reason" in summary) {
    const reason = (summary as { reason?: unknown }).reason;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }
  return run.status;
}

export function evidenceAttentionSummary(attention: EvidenceAttention): string {
  if (attention.kind === "missing") {
    return "Nenhuma evidência registrada no tracker.";
  }

  if (attention.kind === "failed" && attention.failedRuns.length > 0) {
    const details = attention.failedRuns
      .slice(0, 3)
      .map((run) => `${run.repo} (${run.kind}): ${runFailureDetail(run)}`);
    const suffix = attention.failedRuns.length > 3 ? "…" : "";
    return `Validação incompleta — ${details.join("; ")}${suffix}`;
  }

  if (attention.kind === "failed") {
    return `Última evidência com status "${attention.latestRecord?.status ?? "failed"}".`;
  }

  return "";
}

export function evidenceAttentionInstructions(attention: EvidenceAttention): string | null {
  if (attention.kind !== "failed" || attention.failedRuns.length === 0) return null;

  const lines = attention.failedRuns.map(
    (run) => `- ${run.repo} / ${run.kind}: ${run.command} → ${runFailureDetail(run)}`,
  );

  return ["Runs que falharam ou ficaram bloqueados na última tentativa:", ...lines].join("\n");
}
