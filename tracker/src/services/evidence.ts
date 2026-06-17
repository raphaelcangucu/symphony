import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { EvidenceRecord, EvidenceRun } from "@/types/evidence";

import { http, trackerPath } from "./http";

interface BackendEvidenceDto {
  id: number;
  run_id: string;
  session_id?: string | null;
  status?: string | null;
  ui_change?: boolean | null;
  manifest?: { runs?: unknown[] } | null;
  inserted_at?: string | null;
}

interface BackendEvidenceEnvelope {
  data?: BackendEvidenceDto[] | null;
}

function normalizeRun(raw: unknown): EvidenceRun {
  const run = (raw ?? {}) as Record<string, unknown>;
  return {
    kind: typeof run.kind === "string" ? run.kind : "unknown",
    repo: typeof run.repo === "string" ? run.repo : "",
    command: typeof run.command === "string" ? run.command : "",
    status: typeof run.status === "string" ? run.status : "unknown",
    summary: (run.summary as EvidenceRun["summary"]) ?? null,
    report: typeof run.report === "string" ? run.report : null,
    screenshots: Array.isArray(run.screenshots) ? (run.screenshots as string[]) : [],
    videos: Array.isArray(run.videos) ? (run.videos as string[]) : [],
    trace: typeof run.trace === "string" ? run.trace : null,
    duration_ms: typeof run.duration_ms === "number" ? run.duration_ms : null,
  };
}

export function normalizeEvidence(dto: BackendEvidenceDto): EvidenceRecord {
  return {
    id: dto.id,
    runId: dto.run_id,
    sessionId: dto.session_id ?? null,
    status: dto.status ?? "unknown",
    uiChange: dto.ui_change ?? false,
    runs: (dto.manifest?.runs ?? []).map(normalizeRun),
    insertedAt: dto.inserted_at ?? "",
  };
}

export function evidenceArtifactUrl(
  projectSlug: string,
  identifier: string,
  runId: string,
  relative: string,
): string {
  const encodedRelative = relative
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return trackerPath(
    `/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/evidence/${encodeURIComponent(runId)}/artifacts/${encodedRelative}`,
  );
}

export async function listEvidence(
  projectSlug: string,
  identifier: string,
): Promise<EvidenceRecord[]> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.get<BackendEvidenceEnvelope>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/evidence`,
    ),
  );

  return (response.data?.data ?? []).map(normalizeEvidence);
}

export async function deleteEvidenceRun(
  projectSlug: string,
  identifier: string,
  runId: string,
): Promise<void> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");
  const run = requireNonBlank(runId, "runId");

  await http.delete(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/evidence/${encodeURIComponent(run)}`,
    ),
  );
}

export async function clearIssueEvidence(
  projectSlug: string,
  identifier: string,
): Promise<number> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.delete<{ data?: { deleted?: number } }>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/evidence`,
    ),
  );

  return response.data?.data?.deleted ?? 0;
}

export async function clearFailedIssueEvidence(
  projectSlug: string,
  identifier: string,
): Promise<number> {
  const slug = requireProjectSlug(projectSlug);
  const issueIdentifier = requireNonBlank(normalizeIssueIdentifier(identifier), "identifier");

  const response = await http.post<{ data?: { deleted?: number } }>(
    trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueIdentifier)}/evidence/clear-failed`,
    ),
    {},
  );

  return response.data?.data?.deleted ?? 0;
}
