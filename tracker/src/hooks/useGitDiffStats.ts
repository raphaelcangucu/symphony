import { useCallback, useEffect, useState } from "react";

import { i18n } from "@/i18n";
import { isAbortError } from "@/lib/httpAbort";
import { getGitDiffStats, getThreadGitDiffStats } from "@/services/gitDiff";
import type { GitDiffRepoStat, GitDiffType, GitDiffWorkspace } from "@/types/gitDiff";

interface UseGitDiffStatsArgs {
  projectSlug: string;
  identifier: string | null;
  threadId?: number | null;
  type: GitDiffType;
  enabled?: boolean;
}

export interface UseGitDiffStatsResult {
  stats: GitDiffRepoStat[];
  workspace: GitDiffWorkspace | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Per-repo diff counters (files changed, +/-, branch/base) for the diff modal's repo nav and status strips. */
export function useGitDiffStats({
  projectSlug,
  identifier,
  threadId = null,
  type,
  enabled = true,
}: UseGitDiffStatsArgs): UseGitDiffStatsResult {
  const [stats, setStats] = useState<GitDiffRepoStat[]>([]);
  const [workspace, setWorkspace] = useState<GitDiffWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canFetch = Boolean(threadId || (projectSlug && identifier));

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!canFetch) return;
      setLoading(true);
      try {
        const result = threadId
          ? await getThreadGitDiffStats(threadId, type, { signal })
          : await getGitDiffStats(projectSlug, identifier ?? "", type, { signal });
        if (signal.aborted) return;
        setStats(result.stats);
        setWorkspace(result.workspace);
        setError(null);
      } catch (cause) {
        if (isAbortError(cause) || signal.aborted) return;
        setError(i18n.t("issue.diff.errors.loadFailed"));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [canFetch, identifier, projectSlug, threadId, type],
  );

  useEffect(() => {
    if (!canFetch) {
      setStats([]);
      setWorkspace(null);
      setError(null);
      return;
    }

    // When temporarily disabled (e.g. Commits tab), keep the last workspace/stats
    // so the modal subtitle does not flash "unavailable".
    if (!enabled) {
      setError(null);
      return;
    }

    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [enabled, canFetch, load]);

  const refetch = useCallback(async () => {
    const controller = new AbortController();
    await load(controller.signal);
  }, [load]);

  return { stats, workspace, loading, error, refetch };
}
