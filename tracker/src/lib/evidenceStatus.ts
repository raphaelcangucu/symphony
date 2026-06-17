import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
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
  const failedRuns = canonicalRuns(latestRecord.runs).filter((run) => run.status !== "passed");

  if (latestRecord.status !== "passed" || failedRuns.length > 0) {
    return { kind: "failed", latestRecord, failedRuns };
  }

  return { kind: "none", latestRecord, failedRuns: [] };
}

function canonicalRuns(runs: EvidenceRun[]): EvidenceRun[] {
  const groups = new Map<string, EvidenceRun[]>();

  for (const run of runs) {
    const key = `${run.kind}:${run.repo}`;
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }

  return [...groups.values()].map((group) => {
    return (
      group.find((run) => run.status === "passed") ??
      group.find((run) => run.status === "blocked") ??
      group[0]
    );
  });
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

export function evidenceAttentionSummary(
  attention: EvidenceAttention,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): string {
  if (attention.kind === "missing") {
    return t("issue.evidence.missing");
  }

  if (attention.kind === "failed" && attention.failedRuns.length > 0) {
    const details = attention.failedRuns
      .slice(0, 3)
      .map((run) => `${run.repo} (${run.kind}): ${runFailureDetail(run)}`);
    const suffix = attention.failedRuns.length > 3 ? "…" : "";
    return t("issue.evidence.incomplete", { details: details.join("; "), suffix });
  }

  if (attention.kind === "failed") {
    return t("issue.evidence.failedStatus", {
      status: attention.latestRecord?.status ?? "failed",
    });
  }

  return "";
}

export function evidenceAttentionInstructions(
  attention: EvidenceAttention,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
): string | null {
  if (attention.kind !== "failed" || attention.failedRuns.length === 0) return null;

  const lines = attention.failedRuns.map(
    (run) => `- ${run.repo} / ${run.kind}: ${run.command} → ${runFailureDetail(run)}`,
  );

  return [t("issue.evidence.failedRunsHeader"), ...lines].join("\n");
}
