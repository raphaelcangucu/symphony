import type { ChangedDocEntry } from "@/lib/changedDocPaths";
import type { KbTreeNode } from "@/types/knowledgeBase";

export function filterKbTreesByPaths(
  treesByRepo: Record<string, KbTreeNode[]>,
  paths: Set<string>,
): Record<string, KbTreeNode[]> {
  return Object.fromEntries(
    Object.entries(treesByRepo).map(([repoSlug, nodes]) => [repoSlug, filterTreeByPaths(nodes, paths)]),
  );
}

export function filterTreeByPaths(nodes: KbTreeNode[], paths: Set<string>): KbTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "page" || node.type === "asset") return paths.has(node.path) ? [node] : [];

    const children = filterTreeByPaths(node.children, paths);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

/**
 * Ensures changed paths missing from the project tree still appear in Alterados mode.
 * Prefer `ChangedDocEntry[]` so multi-repo workspaces insert into the owning repo.
 * A bare `Set<string>` still works for single-repo projects (legacy).
 */
export function withSyntheticChangedPages(
  treesByRepo: Record<string, KbTreeNode[]>,
  repoSlugs: string[],
  changed: ChangedDocEntry[] | Set<string>,
): Record<string, KbTreeNode[]> {
  const entries = normalizeChangedEntries(changed, repoSlugs);
  const pathSet = new Set(entries.map((entry) => entry.path));
  const filtered = filterKbTreesByPaths(treesByRepo, pathSet);
  return augmentTreesWithChangedPages(filtered, repoSlugs, entries);
}

/**
 * Keeps the full project tree and inserts any issue-branch docs that are missing
 * (e.g. `docs/superpowers/**` that exist only on the task branch).
 */
export function augmentTreesWithChangedPages(
  treesByRepo: Record<string, KbTreeNode[]>,
  repoSlugs: string[],
  changed: ChangedDocEntry[] | Set<string>,
): Record<string, KbTreeNode[]> {
  const entries = normalizeChangedEntries(changed, repoSlugs);
  const presentByRepo = Object.fromEntries(
    Object.entries(treesByRepo).map(([repoSlug, nodes]) => [repoSlug, new Set(collectPagePaths(nodes))]),
  );

  const next: Record<string, KbTreeNode[]> = { ...treesByRepo };

  for (const entry of entries) {
    const repoSlug = resolveRepoSlug(entry.repo, repoSlugs);
    if (!repoSlug) continue;
    const present = presentByRepo[repoSlug] ?? new Set<string>();
    if (present.has(entry.path)) continue;
    next[repoSlug] = insertSyntheticKbPage(next[repoSlug] ?? [], entry.path);
    present.add(entry.path);
    presentByRepo[repoSlug] = present;
  }

  return next;
}

function normalizeChangedEntries(
  changed: ChangedDocEntry[] | Set<string>,
  repoSlugs: string[],
): ChangedDocEntry[] {
  if (changed instanceof Set) {
    if (repoSlugs.length !== 1) return [];
    const [repoSlug] = repoSlugs;
    if (!repoSlug) return [];
    return [...changed].map((path) => ({ repo: repoSlug, path }));
  }
  return changed;
}

function resolveRepoSlug(repoName: string, repoSlugs: string[]): string | null {
  const normalized = repoName.trim().toLowerCase();
  if (!normalized) {
    return repoSlugs.length === 1 ? (repoSlugs[0] ?? null) : null;
  }
  const exact = repoSlugs.find((slug) => slug.toLowerCase() === normalized);
  if (exact) return exact;
  const partial = repoSlugs.find(
    (slug) => slug.toLowerCase().includes(normalized) || normalized.includes(slug.toLowerCase()),
  );
  return partial ?? null;
}

export function insertSyntheticKbPage(nodes: KbTreeNode[], path: string): KbTreeNode[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return nodes;
  return insertSyntheticNode(nodes, segments, "");
}

function collectPagePaths(nodes: KbTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "page" || node.type === "asset") return [node.path];
    return collectPagePaths(node.children);
  });
}

function insertSyntheticNode(nodes: KbTreeNode[], segments: string[], parentPath: string): KbTreeNode[] {
  const [segment, ...rest] = segments;
  if (!segment) return nodes;
  const currentPath = parentPath ? `${parentPath}/${segment}` : segment;

  if (rest.length === 0) {
    if (nodes.some((node) => node.path === currentPath)) return nodes;
    return [
      ...nodes,
      {
        type: "page",
        name: segment,
        path: currentPath,
        title: titleFromFilename(segment),
        order: null,
        favorite: false,
        children: [],
      },
    ];
  }

  const existingIndex = nodes.findIndex((node) => node.type === "folder" && node.path === currentPath);
  if (existingIndex >= 0) {
    return nodes.map((node, index) =>
      index === existingIndex ? { ...node, children: insertSyntheticNode(node.children, rest, currentPath) } : node,
    );
  }

  return [
    ...nodes,
    {
      type: "folder",
      name: segment,
      path: currentPath,
      title: titleFromFilename(segment),
      order: null,
      favorite: false,
      children: insertSyntheticNode([], rest, currentPath),
    },
  ];
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}
