import { http, trackerPath, unwrapData } from "./http";

export type EditorReason = "disabled" | "starting" | "unavailable" | "workspace_missing";

export interface EditorTarget {
  available: boolean;
  url: string | null;
  reason: EditorReason | null;
}

interface BackendEditorDto {
  available?: boolean | null;
  url?: string | null;
  reason?: string | null;
}

const REASONS: readonly EditorReason[] = ["disabled", "starting", "unavailable", "workspace_missing"];

function normalizeReason(value: string | null | undefined): EditorReason | null {
  if (typeof value === "string" && (REASONS as readonly string[]).includes(value)) {
    return value as EditorReason;
  }
  return null;
}

export async function fetchEditorTarget(projectSlug: string, identifier: string): Promise<EditorTarget> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");

  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/editor`),
  );

  const dto = unwrapData<BackendEditorDto>(response);
  const available = dto.available ?? false;

  return {
    available,
    url: available ? dto.url ?? null : null,
    reason: available ? null : normalizeReason(dto.reason),
  };
}
