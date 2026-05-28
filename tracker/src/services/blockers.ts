import type { Blocker, CreateBlockerInput } from "@/types/blocker";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendBlockerDto, normalizeBlocker } from "./mappers";

const DEFAULT_BLOCKER_TYPE = "blocked_by";

export async function listBlockers(projectSlug: string, identifier: string): Promise<Blocker[]> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/blockers`),
  );
  return unwrapData<BackendBlockerDto[]>(response).map((blocker) => normalizeBlocker(blocker, identifier));
}

export async function createBlocker(projectSlug: string, identifier: string, input: CreateBlockerInput): Promise<Blocker> {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!identifier.trim()) throw new Error("identifier is required");
  const blockingIssueIdentifier = input.blockingIssueIdentifier?.trim();
  if (!blockingIssueIdentifier) throw new Error("blockingIssueIdentifier is required");

  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(projectSlug)}/issues/${encodeURIComponent(identifier)}/blockers`),
    {
      target_identifier: blockingIssueIdentifier,
      type: input.type ?? DEFAULT_BLOCKER_TYPE,
    },
  );
  return normalizeBlocker(unwrapData<BackendBlockerDto>(response), identifier);
}
