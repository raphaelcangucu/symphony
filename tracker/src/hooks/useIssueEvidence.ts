import { useCallback } from "react";

import { useAsyncResource } from "@/hooks/useAsyncResource";
import { i18n } from "@/i18n";
import { listEvidence } from "@/services/evidence";
import type { EvidenceRecord } from "@/types/evidence";

interface UseIssueEvidenceArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseIssueEvidenceResult {
  records: EvidenceRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const NO_RECORDS: EvidenceRecord[] = [];

/** Loads the persisted evidence runs (tests, e2e, screenshots, videos) of an issue. */
export function useIssueEvidence({
  projectSlug,
  identifier,
  enabled = true,
}: UseIssueEvidenceArgs): UseIssueEvidenceResult {
  const fetcher = useCallback(() => listEvidence(projectSlug, identifier ?? ""), [projectSlug, identifier]);

  const { data, loading, error, refetch } = useAsyncResource<EvidenceRecord[]>({
    fetcher,
    canFetch: Boolean(identifier && projectSlug),
    enabled,
    errorMessage: () => i18n.t("issue.evidence.errors.loadFailed"),
    initialData: NO_RECORDS,
  });

  return { records: data, loading, error, refetch };
}
