import {
  extractKbRepoHint,
  findKbDocumentReferenceMatches,
  normalizeKbDocumentReference,
} from "@/lib/assistantKbReferences";
import { GENERAL_KB_PROJECT_SLUG, kbGeneralPagePath, kbPagePath } from "@/lib/kbRoutes";
import type { KbProjectOverview, KbTreeNode } from "@/types/knowledgeBase";

export interface KbDocumentLinkTarget {
  path: string;
  repoSlug: string;
  href: string;
}

export type KbDocumentPageIndex = Map<string, Array<{ repoSlug: string; path: string }>>;

/** Builds a docs-relative path → repo matches index from loaded KB trees. */
export function buildKbDocumentPageIndex(treesByRepo: Record<string, KbTreeNode[]>): KbDocumentPageIndex {
  const index: KbDocumentPageIndex = new Map();

  for (const [repoSlug, nodes] of Object.entries(treesByRepo)) {
    if (!repoSlug) continue;
    for (const pagePath of collectPagePaths(nodes)) {
      const existing = index.get(pagePath);
      if (existing) {
        existing.push({ repoSlug, path: pagePath });
      } else {
        index.set(pagePath, [{ repoSlug, path: pagePath }]);
      }
    }
  }

  return index;
}

/**
 * Resolves a raw chat reference (e.g. `docs/foo.md`) to an existing KB page.
 * When the same path exists in multiple repos, prefers `preferredRepoSlug` if present,
 * otherwise the first match in overview/tree iteration order.
 */
export function resolveKbDocumentLinkTarget(
  rawReference: string,
  index: KbDocumentPageIndex,
  projectSlug: string,
  preferredRepoSlug?: string | null,
  overview?: KbProjectOverview | null,
): KbDocumentLinkTarget | null {
  const normalized = normalizeKbDocumentReference(rawReference);
  if (!normalized) return null;

  const matches = index.get(normalized);
  const repoHint = extractKbRepoHint(rawReference);
  const hintedRepo = matchKbRepoHint(repoHint, overview);

  if (matches && matches.length > 0) {
    const preferred =
      (hintedRepo && matches.find((match) => match.repoSlug === hintedRepo)) ||
      (preferredRepoSlug && matches.find((match) => match.repoSlug === preferredRepoSlug));
    const chosen = preferred ?? matches[0];
    if (!chosen) return null;

    return {
      path: chosen.path,
      repoSlug: chosen.repoSlug,
      href: buildKbDocumentHref(projectSlug, chosen.repoSlug, chosen.path),
    };
  }

  // Page may be brand-new (CreatePlan) and not yet indexed — still open with a repo hint.
  if (hintedRepo || preferredRepoSlug) {
    const repoSlug = hintedRepo ?? preferredRepoSlug!;
    return {
      path: normalized,
      repoSlug,
      href: buildKbDocumentHref(projectSlug, repoSlug, normalized),
    };
  }

  return null;
}

/** Match a path segment (or workspace folder name) to a known KB repository slug. */
export function matchKbRepoHint(
  hint: string | null | undefined,
  overview?: KbProjectOverview | null,
): string | null {
  if (!hint || !overview?.repositories?.length) return null;
  const needle = hint.trim().toLowerCase();
  if (!needle) return null;

  const exact = overview.repositories.find((repo) => repo.repoSlug.toLowerCase() === needle);
  if (exact) return exact.repoSlug;

  const byWorkspace = overview.repositories.find((repo) => {
    const workspace = repo.workspacePath?.replaceAll("\\", "/").toLowerCase() ?? "";
    if (!workspace) return false;
    return workspace === needle || workspace.endsWith(`/${needle}`);
  });
  return byWorkspace?.repoSlug ?? null;
}

/**
 * Turns bare / backtick-adjacent existing KB paths into markdown links so the
 * assistant markdown renderer can attach click handlers. Skips tokens that are
 * already link targets (`](path)`).
 */
export function linkifyExistingKbDocumentPaths(
  markdown: string,
  resolve: (rawReference: string) => KbDocumentLinkTarget | null,
): string {
  if (!markdown) return markdown;

  const matches = findKbDocumentReferenceMatches(markdown);
  if (matches.length === 0) return markdown;

  let result = "";
  let lastIndex = 0;
  for (const { raw, start, end } of matches) {
    result += markdown.slice(lastIndex, start);
    const alreadyLinkTarget = start > 0 && markdown[start - 1] === "(";
    result += alreadyLinkTarget || !resolve(raw) ? raw : `[${raw}](${raw})`;
    lastIndex = end;
  }
  result += markdown.slice(lastIndex);

  return result;
}

export function buildKbDocumentHref(projectSlug: string, repoSlug: string, pagePath: string): string {
  if (projectSlug === GENERAL_KB_PROJECT_SLUG) {
    return kbGeneralPagePath(pagePath);
  }

  return kbPagePath(projectSlug, repoSlug, pagePath);
}

function collectPagePaths(nodes: KbTreeNode[]): string[] {
  const paths: string[] = [];

  function walk(list: KbTreeNode[]) {
    for (const node of list) {
      if (node.type === "page" && node.path) {
        paths.push(node.path);
      }
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return paths;
}
