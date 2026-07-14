import { useEffect, useState } from "react";

import { i18n } from "@/i18n";
import { isAbortError } from "@/lib/httpAbort";
import { getGitDiffPatch, getThreadGitDiffPatch } from "@/services/gitDiff";
import type { GitDiffFileChange, GitDiffType } from "@/types/gitDiff";

interface UseGitDiffPatchArgs {
  projectSlug: string;
  identifier: string | null;
  threadId?: number | null;
  type: GitDiffType;
  repo: string | null;
  path: string | null;
  enabled?: boolean;
}

export interface UseGitDiffPatchResult {
  file: GitDiffFileChange | null;
  loading: boolean;
  error: string | null;
}

/** Fetches exactly one file's patch on demand — never the full workspace diff. */
export function useGitDiffPatch({
  projectSlug,
  identifier,
  threadId = null,
  type,
  repo,
  path,
  enabled = true,
}: UseGitDiffPatchArgs): UseGitDiffPatchResult {
  const [file, setFile] = useState<GitDiffFileChange | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canFetch = Boolean(repo && path && (threadId || (projectSlug && identifier)));

  useEffect(() => {
    if (!enabled || !canFetch || !repo || !path) {
      setFile(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const repoName = repo;
    const filePath = path;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const result = threadId
          ? await getThreadGitDiffPatch(threadId, type, repoName, filePath, { signal: controller.signal })
          : await getGitDiffPatch(projectSlug, identifier ?? "", type, repoName, filePath, {
              signal: controller.signal,
            });
        if (controller.signal.aborted) return;
        setFile({ path: result.path, oldPath: null, status: result.status, patch: result.patch });
      } catch (cause) {
        if (isAbortError(cause) || controller.signal.aborted) return;
        setFile(null);
        setError(i18n.t("issue.diff.errors.loadFailed"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [enabled, canFetch, threadId, type, repo, path, projectSlug, identifier]);

  return { file, loading, error };
}
