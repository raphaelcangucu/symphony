import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { isAbortError } from "@/lib/httpAbort";
import { getGitDiffFiles, getThreadGitDiffFiles } from "@/services/gitDiff";
import type { GitDiffFileEntry, GitDiffType } from "@/types/gitDiff";

interface UseGitDiffFilesArgs {
  projectSlug: string;
  identifier: string | null;
  threadId?: number | null;
  type: GitDiffType;
  /** Exact repo name filter; omit (or "all") to include every repo. */
  repo?: string | null;
  query?: string;
  limit?: number;
  enabled?: boolean;
}

export interface UseGitDiffFilesResult {
  files: GitDiffFileEntry[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

/** Paginated, filterable file metadata list from `/diff/files` — never loads patches. */
export function useGitDiffFiles({
  projectSlug,
  identifier,
  threadId = null,
  type,
  repo,
  query,
  limit,
  enabled = true,
}: UseGitDiffFilesArgs): UseGitDiffFilesResult {
  const [files, setFiles] = useState<GitDiffFileEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const canFetch = Boolean(threadId || (projectSlug && identifier));
  const repoFilter = repo && repo !== "all" ? repo : undefined;

  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => {
      const params = { repo: repoFilter, q: query, limit, cursor, signal };
      return threadId
        ? getThreadGitDiffFiles(threadId, type, params)
        : getGitDiffFiles(projectSlug, identifier ?? "", type, params);
    },
    [identifier, limit, projectSlug, query, repoFilter, threadId, type],
  );

  useEffect(() => {
    if (!enabled || !canFetch) {
      setFiles([]);
      setTotal(0);
      setError(null);
      cursorRef.current = null;
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    async function load() {
      try {
        const page = await fetchPage(null, controller.signal);
        if (controller.signal.aborted) return;
        setFiles(page.files);
        setTotal(page.total);
        cursorRef.current = page.nextCursor;
        setError(null);
      } catch (cause) {
        if (isAbortError(cause) || controller.signal.aborted) return;
        setError(i18n.t("issue.diff.errors.loadFailed"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [enabled, canFetch, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!canFetch || !cursorRef.current || loadingMore) return;
    const controller = new AbortController();
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursorRef.current, controller.signal);
      setFiles((current) => [...current, ...page.files]);
      setTotal(page.total);
      cursorRef.current = page.nextCursor;
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(i18n.t("issue.diff.errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }, [canFetch, fetchPage, loadingMore]);

  const refetch = useCallback(async () => {
    if (!canFetch) return;
    const controller = new AbortController();
    setLoading(true);
    try {
      const page = await fetchPage(null, controller.signal);
      setFiles(page.files);
      setTotal(page.total);
      cursorRef.current = page.nextCursor;
      setError(null);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(i18n.t("issue.diff.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [canFetch, fetchPage]);

  return { files, total, loading, loadingMore, hasMore: cursorRef.current != null, error, loadMore, refetch };
}
