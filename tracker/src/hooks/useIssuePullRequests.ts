import { useCallback } from "react";

import { useAsyncResource } from "@/hooks/useAsyncResource";
import { i18n } from "@/i18n";
import { listPullRequests } from "@/services/pullRequests";
import type { PullRequest, PullRequestGroup } from "@/types/pull-request";

// Skip the open-time fetch when the last successful load is newer than this.
const FRESH_WINDOW_MS = 60_000;

interface UseIssuePullRequestsArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
}

export interface UseIssuePullRequestsResult {
  pullRequests: PullRequest[];
  children: PullRequestGroup[];
  supported: boolean;
  available: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

interface PullRequestsSnapshot {
  pullRequests: PullRequest[];
  children: PullRequestGroup[];
  supported: boolean;
  available: boolean;
}

const EMPTY_SNAPSHOT: PullRequestsSnapshot = {
  pullRequests: [],
  children: [],
  supported: false,
  available: false,
};

/**
 * Loads the pull request(s) related to an issue, including CI pipelines, jobs,
 * statuses, and conversation. Fetches when the drawer opens, but only when the
 * cached data is older than FRESH_WINDOW_MS — there is no background polling.
 * Switching issues resets the cache; `refetch` forces a fresh load (e.g. after a
 * manual link/unlink).
 */
export function useIssuePullRequests({
  projectSlug,
  identifier,
  enabled = true,
}: UseIssuePullRequestsArgs): UseIssuePullRequestsResult {
  const fetcher = useCallback(async (): Promise<PullRequestsSnapshot> => {
    const result = await listPullRequests(projectSlug, identifier ?? "", { refresh: true });
    return {
      pullRequests: result.data,
      children: result.children,
      supported: result.supported,
      available: result.available,
    };
  }, [projectSlug, identifier]);

  const { data, loading, error, refetch } = useAsyncResource<PullRequestsSnapshot>({
    fetcher,
    canFetch: Boolean(identifier && projectSlug),
    enabled,
    errorMessage: () => i18n.t("issue.pullRequest.errors.loadFailed"),
    initialData: EMPTY_SNAPSHOT,
    refetchOnActivate: "always",
    freshWindowMs: FRESH_WINDOW_MS,
  });

  return { ...data, loading, error, refetch };
}
