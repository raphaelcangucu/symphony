import { useCallback, useEffect, useRef, useState } from "react";

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
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [children, setChildren] = useState<PullRequestGroup[]>([]);
  const [supported, setSupported] = useState(false);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const lastFetchedAtRef = useRef(0);

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = await listPullRequests(projectSlug, identifier, { refresh: true });
      setPullRequests(result.data);
      setChildren(result.children);
      setSupported(result.supported);
      setAvailable(result.available);
      setError(null);
      hasLoadedRef.current = true;
      lastFetchedAtRef.current = Date.now();
    } catch {
      setError(i18n.t("issue.pullRequest.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  // Reset the cache when the target issue changes so reopening it reloads.
  useEffect(() => {
    hasLoadedRef.current = false;
    lastFetchedAtRef.current = 0;
    setPullRequests([]);
    setChildren([]);
    setSupported(false);
    setAvailable(false);
    setError(null);
    setLoading(false);
  }, [identifier, projectSlug]);

  // Fetch when the drawer opens, skipping if loaded within the fresh window.
  useEffect(() => {
    if (!active) return;
    const fresh =
      hasLoadedRef.current && Date.now() - lastFetchedAtRef.current < FRESH_WINDOW_MS;
    if (fresh) return;
    void refetch();
  }, [active, refetch]);

  return { pullRequests, children, supported, available, loading, error, refetch };
}
