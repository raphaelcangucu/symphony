import {
  KB_DOCUMENT_REFERENCE_TOKEN_RE,
  normalizeKbDocumentReference,
} from "@/lib/assistantKbReferences";
import { GENERAL_KB_PROJECT_SLUG, kbGeneralPagePath, kbPagePath } from "@/lib/kbRoutes";
import type { KbTreeNode } from "@/types/knowledgeBase";

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
): KbDocumentLinkTarget | null {
  const normalized = normalizeKbDocumentReference(rawReference);
  if (!normalized) return null;

  const matches = index.get(normalized);
  if (!matches || matches.length === 0) return null;

  const preferred =
    preferredRepoSlug && matches.find((match) => match.repoSlug === preferredRepoSlug);
  const chosen = preferred ?? matches[0];
  if (!chosen) return null;

  return {
    path: chosen.path,
    repoSlug: chosen.repoSlug,
    href: buildKbDocumentHref(projectSlug, chosen.repoSlug, chosen.path),
  };
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

  const tokenRe = new RegExp(KB_DOCUMENT_REFERENCE_TOKEN_RE.source, KB_DOCUMENT_REFERENCE_TOKEN_RE.flags);
  return markdown.replace(tokenRe, (raw, offset: number) => {
    if (offset > 0 && markdown[offset - 1] === "(") return raw;
    if (!resolve(raw)) return raw;
    return `[${raw}](${raw})`;
  });
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
