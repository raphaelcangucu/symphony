import { useCallback, useEffect, useRef, useState } from "react";
import type { KbPage } from "@/types/knowledgeBase";
import { getPage } from "@/services/knowledgeBase";

type KbPageLoader = (projectSlug: string, repoSlug: string, path: string) => Promise<KbPage>;

export interface UseKbPageResult {
  page: KbPage | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useKbPage(
  projectSlug: string,
  repoSlug: string | null,
  path: string | null,
  loadPage: KbPageLoader = getPage,
): UseKbPageResult {
  const [page, setPage] = useState<KbPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!repoSlug || !path) {
      setPage(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loadPage(projectSlug, repoSlug, path);
      if (requestId === requestIdRef.current) setPage(result);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err as Error);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [loadPage, projectSlug, repoSlug, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { page, loading, error, reload };
}
