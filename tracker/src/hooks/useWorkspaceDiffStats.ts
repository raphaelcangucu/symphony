import { useEffect, useState } from "react";

import { combineDiffStats, diffStatsFromPatch, type DiffStats } from "@/lib/diffStats";
import { getGitDiff, getThreadGitDiff } from "@/services/gitDiff";

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

    let cancelled = false;

    async function load() {
      try {
        const result = threadId
          ? await getThreadGitDiff(threadId, "uncommitted")
          : await getGitDiff(projectSlug ?? "", issueIdentifier ?? "", "uncommitted");
        if (cancelled) return;
        const combined = combineDiffStats(
          result.repos.flatMap((repo) => repo.files.map((file) => diffStatsFromPatch(file.patch))),
        );
        setStats(combined.additions > 0 || combined.deletions > 0 ? combined : null);
      } catch {
        if (!cancelled) setStats(null);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [enabled, issueIdentifier, projectSlug, threadId]);

  return stats;
}
