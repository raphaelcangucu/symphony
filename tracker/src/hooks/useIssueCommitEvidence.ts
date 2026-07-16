import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { isAbortError } from "@/lib/httpAbort";
import { listCommitEvidence } from "@/services/commitEvidence";
import type { CommitEvidenceSummary, CommitEvidenceWorkspace } from "@/types/commitEvidence";

interface UseIssueCommitEvidenceArgs {
  projectSlug: string;
  identifier: string | null;
  enabled?: boolean;
  limit?: number;
}

export interface UseIssueCommitEvidenceResult {
  commits: CommitEvidenceSummary[];
  total: number;
  workspace: CommitEvidenceWorkspace | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

const DEFAULT_LIMIT = 20;

/** Loads git commits from the issue workspace (agent work, separate from test evidence). */
export function useIssueCommitEvidence({
  projectSlug,
  identifier,
  enabled = true,
  limit = DEFAULT_LIMIT,
}: UseIssueCommitEvidenceArgs): UseIssueCommitEvidenceResult {
  const [commits, setCommits] = useState<CommitEvidenceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [workspace, setWorkspace] = useState<CommitEvidenceWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const active = enabled && Boolean(identifier && projectSlug);

  const fetchPage = useCallback(
    (cursor: string | null, signal?: AbortSignal) => {
      if (!identifier || !projectSlug) {
        throw new Error("projectSlug and identifier are required");
      }
      return listCommitEvidence(projectSlug, identifier, { limit, cursor, signal });
    },
    [identifier, limit, projectSlug],
  );

  useEffect(() => {
    setCommits([]);
    setTotal(0);
    setWorkspace(null);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setHasMore(false);
    cursorRef.current = null;
  }, [identifier, projectSlug, limit]);

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    setLoading(true);

    async function load() {
      try {
        const page = await fetchPage(null, controller.signal);
        if (controller.signal.aborted) return;
        setCommits(page.commits);
        setTotal(page.total);
        setWorkspace(page.workspace);
        cursorRef.current = page.nextCursor;
        setHasMore(page.nextCursor != null);
        setError(null);
      } catch (cause) {
        if (isAbortError(cause) || controller.signal.aborted) return;
        setError(i18n.t("issue.commits.errors.loadFailed"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [active, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!active || !cursorRef.current || loadingMore || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursorRef.current);
      setCommits((current) => [...current, ...page.commits]);
      setTotal(page.total);
      setWorkspace(page.workspace);
      cursorRef.current = page.nextCursor;
      setHasMore(page.nextCursor != null);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(i18n.t("issue.commits.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [active, fetchPage, loadingMore]);

  const refetch = useCallback(async () => {
    if (!active || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const page = await fetchPage(null);
      setCommits(page.commits);
      setTotal(page.total);
      setWorkspace(page.workspace);
      cursorRef.current = page.nextCursor;
      setHasMore(page.nextCursor != null);
      setError(null);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(i18n.t("issue.commits.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [active, fetchPage]);

  return { commits, total, workspace, loading, loadingMore, hasMore, error, loadMore, refetch };
}
