import { isAxiosError } from "axios";

import { getIssuePage, getPage, saveIssuePage } from "@/services/knowledgeBase";

export interface EnsureIssueKbPageInput {
  projectSlug: string;
  issueIdentifier: string;
  repoSlug: string;
  /** Docs-relative path (no `docs/` prefix), e.g. `superpowers/specs/foo.md`. */
  path: string;
  markdown: string;
  /** Optional sibling repos to probe before creating. */
  fallbackRepoSlugs?: string[];
}

export interface EnsureIssueKbPageResult {
  status: "exists" | "created";
  repoSlug: string;
}

/**
 * Opens (or materializes) a KB page in the issue worktree.
 *
 * CreatePlan often references a docs path in markdown without writing the file.
 * When the page is missing, write the supplied markdown so "Open in KB" works.
 */
export async function ensureIssueKbPage(input: EnsureIssueKbPageInput): Promise<EnsureIssueKbPageResult> {
  const projectSlug = input.projectSlug.trim();
  const issueIdentifier = input.issueIdentifier.trim();
  const path = input.path.trim();
  const markdown = input.markdown.trim();
  const primaryRepo = input.repoSlug.trim();

  if (!projectSlug) throw new Error("projectSlug is required");
  if (!issueIdentifier) throw new Error("issueIdentifier is required");
  if (!path) throw new Error("path is required");
  if (!primaryRepo) throw new Error("repoSlug is required");
  if (!markdown) throw new Error("markdown is required");

  const repos = uniqueRepos([primaryRepo, ...(input.fallbackRepoSlugs ?? [])]);

  for (const repoSlug of repos) {
    try {
      await getIssuePage(projectSlug, issueIdentifier, repoSlug, path);
      return { status: "exists", repoSlug };
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  for (const repoSlug of repos) {
    try {
      await getPage(projectSlug, repoSlug, path);
      return { status: "exists", repoSlug };
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  await saveIssuePage(projectSlug, issueIdentifier, primaryRepo, path, {
    frontmatter: {},
    body: markdown,
  });

  return { status: "created", repoSlug: primaryRepo };
}

function isNotFound(error: unknown): boolean {
  if (isAxiosError(error) && error.response?.status === 404) return true;
  if (error && typeof error === "object" && "response" in error) {
    const status = (error as { response?: { status?: unknown } }).response?.status;
    return status === 404;
  }
  return false;
}

function uniqueRepos(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
