import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/lib/httpAbort";
import { getGitDiffSummaries } from "@/services/gitDiff";
import type { GitDiffRepoSummary } from "@/types/gitDiff";

interface UseWorkspaceRepoSummariesArgs {
  projectSlug?: string;
  issueIdentifier?: string | null;
  enabled?: boolean;
}

interface UseWorkspaceRepoSummariesResult {
  localBranch: string | null;
  aheadCount: number;
  dirty: boolean;
  summaries: GitDiffRepoSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const EMPTY_SUMMARIES: GitDiffRepoSummary[] = [];

export function useWorkspaceRepoSummaries({
  projectSlug,
  issueIdentifier,
  enabled = true,
}: UseWorkspaceRepoSummariesArgs): UseWorkspaceRepoSummariesResult {
  const [summaries, setSummaries] = useState<GitDiffRepoSummary[]>(EMPTY_SUMMARIES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  const refetch = useCallback(() => {
    setRequestVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !projectSlug || !issueIdentifier) {
      setSummaries(EMPTY_SUMMARIES);
      setLoading(false);
      setError(null);
      return;
    }

    const resolvedProjectSlug = projectSlug;
    const resolvedIssueIdentifier = issueIdentifier;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await getGitDiffSummaries(resolvedProjectSlug, resolvedIssueIdentifier, {
          signal: controller.signal,
        });
        setSummaries(result.summaries);
      } catch (cause) {
        if (isAbortError(cause)) return;
        setSummaries(EMPTY_SUMMARIES);
        setError(cause instanceof Error ? cause.message : "Could not load workspace repository summaries.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [enabled, issueIdentifier, projectSlug, requestVersion]);

  return useMemo(() => {
    const localBranch =
      summaries.find((summary) => summary.dirty && summary.branch)?.branch ??
      summaries.find((summary) => summary.branch)?.branch ??
      null;

    return {
      localBranch,
      aheadCount: Math.max(0, ...summaries.map((summary) => summary.aheadCount)),
      dirty: summaries.some((summary) => summary.dirty),
      summaries,
      loading,
      error,
      refetch,
    };
  }, [error, loading, refetch, summaries]);
}
