import { useCallback, useEffect, useState } from "react";

import { collectChangedDocEntries, type ChangedDocEntry } from "@/lib/changedDocPaths";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { getGitDiff } from "@/services/gitDiff";

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

    void getGitDiff(projectSlug, normalizedIdentifier, "uncommitted")
      .then((diff) => {
        if (cancelled) return;
        setEntries(collectChangedDocEntries(diff));
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

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
