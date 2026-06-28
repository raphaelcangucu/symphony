import { useEffect, useState } from "react";

import type { ResolvedMention } from "@/components/assistant/contextMentions";
import { matchesPickerSearch } from "@/lib/pickerOptions";
import { listIssues } from "@/services/issues";
import { listPullRequests } from "@/services/pullRequests";
import { searchWorkspaceFiles } from "@/services/workspaceFiles";

const DEBOUNCE_MS = 150;
const PER_GROUP_LIMIT = 8;

async function issueOptions(projectSlug: string, query: string): Promise<ResolvedMention[]> {
  try {
    const issues = await listIssues(projectSlug, { search: query });
    return issues
      .filter((issue) => matchesPickerSearch(query.toLowerCase(), issue.identifier, issue.title))
      .slice(0, PER_GROUP_LIMIT)
      .map((issue) => ({
        type: "issue" as const,
        id: issue.identifier,
        label: issue.title ?? undefined,
        detail: issue.status ?? undefined,
      }));
  } catch {
    return [];
  }
}

async function fileOptions(
  projectSlug: string,
  identifier: string,
  query: string,
): Promise<ResolvedMention[]> {
  const paths = await searchWorkspaceFiles(projectSlug, identifier, query);
  return paths.slice(0, PER_GROUP_LIMIT).map((path) => ({ type: "file" as const, id: path }));
}

async function prOptions(
  projectSlug: string,
  identifier: string,
  query: string,
): Promise<ResolvedMention[]> {
  try {
    const result = await listPullRequests(projectSlug, identifier);
    return result.data
      .filter((pr) => matchesPickerSearch(query.toLowerCase(), String(pr.number), pr.title ?? ""))
      .slice(0, PER_GROUP_LIMIT)
      .map((pr) => ({
        type: "pr" as const,
        id: String(pr.number),
        label: pr.title ?? undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * Fans out a single mention `query` to issues, workspace files, and PRs for the
 * current issue. Debounced and self-cancelling; every source fails soft to `[]`
 * so one slow/missing source never blocks the others. `query === null` (menu
 * closed) clears results without fetching.
 */
export function useContextMentionData(
  projectSlug: string,
  identifier: string,
  query: string | null,
): ResolvedMention[] {
  const [options, setOptions] = useState<ResolvedMention[]>([]);

  useEffect(() => {
    if (query === null) {
      setOptions([]);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(() => {
      void Promise.all([
        issueOptions(projectSlug, query),
        fileOptions(projectSlug, identifier, query),
        prOptions(projectSlug, identifier, query),
      ]).then(([issues, files, prs]) => {
        if (!cancelled) setOptions([...issues, ...files, ...prs]);
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [projectSlug, identifier, query]);

  return options;
}
