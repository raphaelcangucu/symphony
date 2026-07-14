import { useEffect, useState } from "react";

import { isAbortError } from "@/lib/httpAbort";
import { combineDiffStats, type DiffStats } from "@/lib/diffStats";
import { getGitDiffStats, getThreadGitDiffStats } from "@/services/gitDiff";

interface UseWorkspaceDiffStatsArgs {
  projectSlug?: string;
  issueIdentifier?: string | null;
  threadId?: number | null;
  enabled?: boolean;
}

export function useWorkspaceDiffStats({
  projectSlug,
  issueIdentifier,
  threadId = null,
  enabled = true,
}: UseWorkspaceDiffStatsArgs): DiffStats | null {
  const [stats, setStats] = useState<DiffStats | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }

    if (!threadId && (!projectSlug || !issueIdentifier)) {
      setStats(null);
      return;
    }

    const controller = new AbortController();

    async function load() {
      try {
        const result = threadId
          ? await getThreadGitDiffStats(threadId, "uncommitted", { signal: controller.signal })
          : await getGitDiffStats(projectSlug ?? "", issueIdentifier ?? "", "uncommitted", {
              signal: controller.signal,
            });
        const combined = combineDiffStats(
          result.stats.map((stat) => ({ additions: stat.additions, deletions: stat.deletions })),
        );
        setStats(combined.additions > 0 || combined.deletions > 0 ? combined : null);
      } catch (cause) {
        if (isAbortError(cause)) return;
        setStats(null);
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [enabled, issueIdentifier, projectSlug, threadId]);

  return stats;
}
