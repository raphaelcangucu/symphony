import { useCallback, useEffect, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { getGitDiff, getThreadGitDiff } from "@/services/gitDiff";
import type { GitDiffRepo, GitDiffType, GitDiffWorkspace } from "@/types/gitDiff";

interface UseGitDiffArgs {
  projectSlug: string;
  identifier: string | null;
  threadId?: number | null;
  type: GitDiffType;
  enabled?: boolean;
}

export interface UseGitDiffResult {
  repos: GitDiffRepo[];
  workspace: GitDiffWorkspace | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useGitDiff({
  projectSlug,
  identifier,
  threadId = null,
  type,
  enabled = true,
}: UseGitDiffArgs): UseGitDiffResult {
  const [repos, setRepos] = useState<GitDiffRepo[]>([]);
  const [workspace, setWorkspace] = useState<GitDiffWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const active = enabled && Boolean(threadId || (identifier && projectSlug));

  const refetch = useCallback(async () => {
    if (!threadId && (!identifier || !projectSlug)) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const result = threadId ? await getThreadGitDiff(threadId, type) : await getGitDiff(projectSlug, identifier!, type);
      setRepos(result.repos);
      setWorkspace(result.workspace);
      setError(null);
      hasLoadedRef.current = true;
    } catch {
      setError(i18n.t("issue.diff.errors.loadFailed"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [identifier, projectSlug, threadId, type]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setRepos([]);
    setWorkspace(null);
    setError(null);
    setLoading(false);
  }, [identifier, projectSlug, threadId, type]);

  useEffect(() => {
    if (!active) return;
    if (hasLoadedRef.current) return;
    void refetch();
  }, [active, refetch]);

  return { repos, workspace, loading, error, refetch };
}
