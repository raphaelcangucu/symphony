import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { listCommitEvidence } from "@/services/commitEvidence";
import type { CommitEvidenceSummary, CommitEvidenceWorkspace } from "@/types/commitEvidence";

interface UseIssueCommitEvidenceArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseIssueCommitEvidenceResult {
  commits: CommitEvidenceSummary[];
  workspace: CommitEvidenceWorkspace | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Loads git commits from the issue workspace (agent work, separate from test evidence). */
export function useIssueCommitEvidence({
  projectSlug,
  identifier,
  enabled = true,
}: UseIssueCommitEvidenceArgs): UseIssueCommitEvidenceResult {
  const [commits, setCommits] = useState<CommitEvidenceSummary[]>([]);
  const [workspace, setWorkspace] = useState<CommitEvidenceWorkspace | null>(null);
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
      const result = await listCommitEvidence(projectSlug, identifier);
      setCommits(result.commits);
      setWorkspace(result.workspace);
      setError(null);
      hasLoadedRef.current = true;
    } catch {
      setError(i18n.t("issue.commits.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setCommits([]);
    setWorkspace(null);
    setError(null);
    setLoading(false);
  }, [identifier, projectSlug]);

  useEffect(() => {
    if (!active) return;
    if (hasLoadedRef.current) return;
    void refetch();
  }, [active, refetch]);

  return { commits, workspace, loading, error, refetch };
}
