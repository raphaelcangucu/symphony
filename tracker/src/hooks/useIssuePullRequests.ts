import { useCallback, useEffect, useRef, useState } from "react";

import { listPullRequests } from "@/services/pullRequests";
import type { PullRequest } from "@/types/pull-request";

const DEFAULT_INTERVAL_MS = 20_000;

interface UseIssuePullRequestsArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
  intervalMs?: number;
}

export interface UseIssuePullRequestsResult {
  pullRequests: PullRequest[];
  supported: boolean;
  available: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Loads the pull request(s) related to an issue, including CI pipelines, jobs,
 * statuses, and conversation. Polls lightly while enabled so check results stay
 * fresh without flashing the panel (loading is only true on the first fetch).
 */
export function useIssuePullRequests({
  projectSlug,
  identifier,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseIssuePullRequestsArgs): UseIssuePullRequestsResult {
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [supported, setSupported] = useState(false);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);

  const refetch = useCallback(async () => {
    if (!identifier || !projectSlug) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const result = await listPullRequests(projectSlug, identifier);
      setPullRequests(result.data);
      setSupported(result.supported);
      setAvailable(result.available);
      setError(null);
      hasLoadedRef.current = true;
    } catch {
      setError("Could not load pull request details.");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug]);

  useEffect(() => {
    hasLoadedRef.current = false;
    if (!active) {
      setPullRequests([]);
      setSupported(false);
      setAvailable(false);
      setError(null);
      setLoading(false);
      return undefined;
    }

    void refetch();

    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const timer = setInterval(() => {
      if (!isHidden()) void refetch();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [active, intervalMs, refetch]);

  return { pullRequests, supported, available, loading, error, refetch };
}
