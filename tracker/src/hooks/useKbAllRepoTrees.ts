import { useCallback, useEffect, useRef, useState } from "react";

import { getRepoTree } from "@/services/knowledgeBase";
import type { KbRepoTree, KbTreeNode } from "@/types/knowledgeBase";

type KbRepoTreeLoader = (projectSlug: string, repoSlug: string) => Promise<KbRepoTree>;

export interface UseKbAllRepoTreesResult {
  treesByRepo: Record<string, KbTreeNode[]>;
  loading: boolean;
  reloadRepo: (repoSlug: string) => Promise<void>;
  reloadAll: () => Promise<void>;
}

export function useKbAllRepoTrees(
  projectSlug: string,
  repoSlugs: string[],
  loadRepoTree: KbRepoTreeLoader = getRepoTree,
): UseKbAllRepoTreesResult {
  const [treesByRepo, setTreesByRepo] = useState<Record<string, KbTreeNode[]>>({});
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const repoSlugsKey = repoSlugs.join("\0");

  const reloadRepo = useCallback(
    async (repoSlug: string) => {
      if (!projectSlug || !repoSlug) return;
      try {
        const result = await loadRepoTree(projectSlug, repoSlug);
        setTreesByRepo((prev) => ({ ...prev, [repoSlug]: result.tree }));
      } catch {
        setTreesByRepo((prev) => ({ ...prev, [repoSlug]: prev[repoSlug] ?? [] }));
      }
    },
    [loadRepoTree, projectSlug],
  );

  const reloadAll = useCallback(async () => {
    const activeRepoSlugs = repoSlugsKey ? repoSlugsKey.split("\0") : [];
    if (!projectSlug || activeRepoSlugs.length === 0) {
      setTreesByRepo({});
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const entries = await Promise.all(
        activeRepoSlugs.map(async (repoSlug) => {
          try {
            const result = await loadRepoTree(projectSlug, repoSlug);
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
  }, [loadRepoTree, projectSlug, repoSlugsKey]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  return { treesByRepo, loading, reloadRepo, reloadAll };
}
