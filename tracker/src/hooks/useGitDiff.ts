import { useCallback } from "react";

import { useAsyncResource } from "@/hooks/useAsyncResource";
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

interface GitDiffSnapshot {
  repos: GitDiffRepo[];
  workspace: GitDiffWorkspace | null;
}

const EMPTY_SNAPSHOT: GitDiffSnapshot = { repos: [], workspace: null };

export function useGitDiff({
  projectSlug,
  identifier,
  threadId = null,
  type,
  enabled = true,
}: UseGitDiffArgs): UseGitDiffResult {
  const fetcher = useCallback(async (): Promise<GitDiffSnapshot> => {
    const result = threadId ? await getThreadGitDiff(threadId, type) : await getGitDiff(projectSlug, identifier!, type);
    return { repos: result.repos, workspace: result.workspace };
  }, [identifier, projectSlug, threadId, type]);

  const { data, loading, error, refetch } = useAsyncResource<GitDiffSnapshot>({
    fetcher,
    canFetch: Boolean(threadId || (identifier && projectSlug)),
    enabled,
    errorMessage: () => i18n.t("issue.diff.errors.loadFailed"),
    initialData: EMPTY_SNAPSHOT,
  });

  return { repos: data.repos, workspace: data.workspace, loading, error, refetch };
}
