import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";
import type { Blocker, CreateBlockerInput } from "@/types/blocker";

import { http, trackerPath, unwrapData } from "./http";
import { type BackendBlockerDto, normalizeBlocker } from "./mappers";

const DEFAULT_BLOCKER_TYPE = "blocked_by";

export async function listBlockers(projectSlug: string, identifier: string): Promise<Blocker[]> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const response = await http.get(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/blockers`),
  );
  return unwrapData<BackendBlockerDto[]>(response).map((blocker) => normalizeBlocker(blocker, issueId));
}

export async function createBlocker(projectSlug: string, identifier: string, input: CreateBlockerInput): Promise<Blocker> {
  const slug = requireProjectSlug(projectSlug);
  const issueId = requireNonBlank(identifier, "identifier");
  const blockingIssueIdentifier = requireNonBlank(
    input.blockingIssueIdentifier ?? "",
    "blockingIssueIdentifier",
  );

  const response = await http.post(
    trackerPath(`/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/blockers`),
    {
      target_identifier: blockingIssueIdentifier,
      type: input.type ?? DEFAULT_BLOCKER_TYPE,
    },
  );
  return normalizeBlocker(unwrapData<BackendBlockerDto>(response), issueId);
}
