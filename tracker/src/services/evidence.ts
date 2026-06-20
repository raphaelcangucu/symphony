import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { EvidenceArtifactRef, EvidenceRecord, EvidenceRun } from "@/types/evidence";

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

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((entry): entry is string => typeof entry === "string");
}

function normalizeArtifactRef(raw: unknown): EvidenceArtifactRef | null {
  if (typeof raw === "string" && raw.trim()) {
    return { path: raw.trim(), label: null, navigations: [] };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const entry = raw as Record<string, unknown>;
  if (typeof entry.path !== "string" || !entry.path.trim()) return null;

  return {
    path: entry.path.trim(),
    label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null,
    navigations: normalizeStringList(entry.navigations),
  };
}

function normalizeArtifactList(values: unknown): EvidenceArtifactRef[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(normalizeArtifactRef)
    .filter((entry): entry is EvidenceArtifactRef => entry !== null);
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
    screenshots: normalizeArtifactList(run.screenshots),
    videos: normalizeArtifactList(run.videos),
    trace: typeof run.trace === "string" ? run.trace : null,
    duration_ms: typeof run.duration_ms === "number" ? run.duration_ms : null,
    blocked_reason: typeof run.blocked_reason === "string" ? run.blocked_reason : null,
    navigations: normalizeStringList(run.navigations),
    proof: run.proof && typeof run.proof === "object" && !Array.isArray(run.proof)
      ? (run.proof as Record<string, unknown>)
      : null,
  };
}

export async function fetchEvidenceArtifactText(url: string): Promise<string> {
  const response = await http.get<string>(url, { responseType: "text" });
  return response.data;
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
