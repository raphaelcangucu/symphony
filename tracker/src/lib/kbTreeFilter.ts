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

/** Ensures changed paths missing from the project tree still appear in Alterados mode. */
export function withSyntheticChangedPages(
  treesByRepo: Record<string, KbTreeNode[]>,
  repoSlugs: string[],
  changedPaths: Set<string>,
): Record<string, KbTreeNode[]> {
  const filtered = filterKbTreesByPaths(treesByRepo, changedPaths);
  const present = new Set(
    Object.values(treesByRepo).flatMap((nodes) => collectPagePaths(nodes)),
  );

  if (repoSlugs.length !== 1) {
    return filtered;
  }

  const [repoSlug] = repoSlugs;
  if (!repoSlug) return filtered;

  let tree = filtered[repoSlug] ?? [];
  for (const path of changedPaths) {
    if (!present.has(path)) {
      tree = insertSyntheticKbPage(tree, path);
    }
  }
  return { ...filtered, [repoSlug]: tree };
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
