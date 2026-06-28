import { requireProjectSlug, requireNonBlank } from "@/lib/serviceValidation";

import { http, trackerPath, unwrapData } from "./http";

/**
 * Searches the issue's sandboxed workspace tree for files matching `query`.
 * Backed by the read-only `GET …/issues/:id/files` endpoint. Returns relative
 * paths; resolves to `[]` (never throws) so the mention popover degrades quietly
 * when no workspace exists or the request fails.
 */
export async function searchWorkspaceFiles(
  projectSlug: string,
  identifier: string,
  query: string,
): Promise<string[]> {
  const term = query?.trim() ?? "";
  if (term.length === 0) return [];

  try {
    const slug = requireProjectSlug(projectSlug);
    const issueId = requireNonBlank(identifier, "identifier");
    const path = trackerPath(
      `/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/files`,
    );
    const response = await http.get(path, { params: { q: term } });
    const data = unwrapData<string[]>(response);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
