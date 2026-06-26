import { useCallback, useEffect, useRef, useState } from "react";

import { getRepoTree } from "@/services/knowledgeBase";
import type { KbTreeNode } from "@/types/knowledgeBase";

export interface UseKbAllRepoTreesResult {
  treesByRepo: Record<string, KbTreeNode[]>;
  loading: boolean;
  reloadRepo: (repoSlug: string) => Promise<void>;
  reloadAll: () => Promise<void>;
}

export function useKbAllRepoTrees(projectSlug: string, repoSlugs: string[]): UseKbAllRepoTreesResult {
  const [treesByRepo, setTreesByRepo] = useState<Record<string, KbTreeNode[]>>({});
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const repoSlugsKey = repoSlugs.join("\0");

  const reloadRepo = useCallback(
    async (repoSlug: string) => {
      if (!projectSlug || !repoSlug) return;
      try {
        const result = await getRepoTree(projectSlug, repoSlug);
        setTreesByRepo((prev) => ({ ...prev, [repoSlug]: result.tree }));
      } catch {
        setTreesByRepo((prev) => ({ ...prev, [repoSlug]: prev[repoSlug] ?? [] }));
      }
    },
    [projectSlug],
  );

  const reloadAll = useCallback(async () => {
    if (!projectSlug || repoSlugs.length === 0) {
      setTreesByRepo({});
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const entries = await Promise.all(
        repoSlugs.map(async (repoSlug) => {
          try {
            const result = await getRepoTree(projectSlug, repoSlug);
            return [repoSlug, result.tree] as const;
          } catch {
            return [repoSlug, []] as const;
          }
        }),
      );
      if (requestId !== requestIdRef.current) return;
      setTreesByRepo(Object.fromEntries(entries));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [projectSlug, repoSlugsKey, repoSlugs]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  return { treesByRepo, loading, reloadRepo, reloadAll };
}
