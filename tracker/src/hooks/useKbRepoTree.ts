import { useCallback, useEffect, useRef, useState } from "react";
import type { KbRepoTree } from "@/types/knowledgeBase";
import { getRepoTree } from "@/services/knowledgeBase";

export interface UseKbRepoTreeResult {
  tree: KbRepoTree | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useKbRepoTree(projectSlug: string, repoSlug: string | null): UseKbRepoTreeResult {
  const [tree, setTree] = useState<KbRepoTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!repoSlug) {
      setTree(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getRepoTree(projectSlug, repoSlug);
      if (requestId === requestIdRef.current) setTree(result);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err as Error);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [projectSlug, repoSlug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { tree, loading, error, reload };
}
