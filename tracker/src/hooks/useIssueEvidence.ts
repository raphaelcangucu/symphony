import { useCallback, useEffect, useRef, useState } from "react";

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

/** Loads the persisted evidence runs (tests, e2e, screenshots, videos) of an issue. */
export function useIssueEvidence({
  projectSlug,
  identifier,
  enabled = true,
}: UseIssueEvidenceArgs): UseIssueEvidenceResult {
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = await listEvidence(projectSlug, identifier);
      setRecords(result);
      setError(null);
      hasLoadedRef.current = true;
    } catch {
      setError(i18n.t("issue.evidence.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setRecords([]);
    setError(null);
    setLoading(false);
  }, [identifier, projectSlug]);

  useEffect(() => {
    if (!active) return;
    if (hasLoadedRef.current) return;
    void refetch();
  }, [active, refetch]);

  return { records, loading, error, refetch };
}
