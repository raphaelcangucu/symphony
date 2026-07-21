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
  const normalizedProjectSlug = projectSlug?.trim() ?? "";
  const normalizedIssueIdentifier = issueIdentifier?.trim() || null;
  const hasIssueScope = normalizedIssueIdentifier !== null;
  const resolvedThreadId =
    !hasIssueScope && Number.isInteger(threadId) && (threadId ?? 0) > 0 ? threadId : null;

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }

    if (
      (hasIssueScope && !normalizedProjectSlug) ||
      (!hasIssueScope && resolvedThreadId === null)
    ) {
      setStats(null);
      return;
    }

    const controller = new AbortController();

    async function load() {
      try {
        const result = hasIssueScope
          ? await getGitDiffStats(normalizedProjectSlug, normalizedIssueIdentifier, "uncommitted", {
              signal: controller.signal,
            })
          : await getThreadGitDiffStats(resolvedThreadId!, "uncommitted", {
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
  }, [
    enabled,
    hasIssueScope,
    normalizedIssueIdentifier,
    normalizedProjectSlug,
    resolvedThreadId,
  ]);

  return stats;
}
