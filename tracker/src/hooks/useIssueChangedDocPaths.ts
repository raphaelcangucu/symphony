import { useCallback, useEffect, useState } from "react";

import type { ChangedDocEntry } from "@/lib/changedDocPaths";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { getIssueRepoTree, getProjectOverview } from "@/services/knowledgeBase";
import type { KbTreeNode } from "@/types/knowledgeBase";

interface UseIssueChangedDocPathsArgs {
  projectSlug?: string | null;
  issueIdentifier?: string | null;
  enabled?: boolean;
  /** Bump to force a reload (e.g. after assistant_document_changed). */
  refreshKey?: number;
}

interface UseIssueChangedDocPathsResult {
  entries: ChangedDocEntry[];
  paths: string[];
  count: number;
  loading: boolean;
  reload: () => void;
}

/**
 * Docs changed in an issue working tree (committed vs base, plus dirty/untracked).
 *
 * Uses the issue KB tree API — the same source as the issue-scoped sidebar —
 * instead of the uncommitted-only git diff, so branch-committed docs like
 * `docs/superpowers/**` still appear after they are committed.
 */
export function useIssueChangedDocPaths({
  projectSlug = null,
  issueIdentifier = null,
  enabled = true,
  refreshKey = 0,
}: UseIssueChangedDocPathsArgs): UseIssueChangedDocPathsResult {
  const [entries, setEntries] = useState<ChangedDocEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const normalizedIdentifier = issueIdentifier ? normalizeIssueIdentifier(issueIdentifier) || null : null;
  const canLoad = Boolean(enabled && projectSlug && normalizedIdentifier);

  const reload = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!canLoad || !projectSlug || !normalizedIdentifier) {
      setEntries([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const overview = await getProjectOverview(projectSlug);
        if (cancelled) return;

        const repoSlugs = overview.repositories.map((repo) => repo.repoSlug).filter(Boolean);
        const trees = await Promise.all(
          repoSlugs.map(async (repoSlug) => {
            try {
              const tree = await getIssueRepoTree(projectSlug, normalizedIdentifier, repoSlug);
              return { repoSlug, nodes: tree.tree };
            } catch {
              return { repoSlug, nodes: [] as KbTreeNode[] };
            }
          }),
        );
        if (cancelled) return;

        setEntries(collectEntriesFromIssueTrees(trees));
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canLoad, normalizedIdentifier, projectSlug, refreshKey, reloadToken]);

  const paths = entries.map((entry) => entry.path);

  return {
    entries,
    paths,
    count: entries.length,
    loading,
    reload,
  };
}

function collectEntriesFromIssueTrees(
  trees: Array<{ repoSlug: string; nodes: KbTreeNode[] }>,
): ChangedDocEntry[] {
  const seen = new Set<string>();
  const entries: ChangedDocEntry[] = [];

  for (const { repoSlug, nodes } of trees) {
    for (const path of collectPagePaths(nodes)) {
      const key = `${repoSlug}\0${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ repo: repoSlug, path });
    }
  }

  return entries;
}

function collectPagePaths(nodes: KbTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "page") return [node.path];
    if (node.type === "folder") return collectPagePaths(node.children);
    return [];
  });
}
