import type { KbTreeNode } from "@/types/knowledgeBase";

export function collectPagePaths(nodes: KbTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === "page") paths.push(node.path);
    paths.push(...collectPagePaths(node.children));
  }
  return paths;
}

export function findSiblingNodes(tree: KbTreeNode[], parentPath: string): KbTreeNode[] | null {
  if (parentPath === "") return tree;

  for (const node of tree) {
    if (node.type === "folder" && node.path === parentPath) return node.children;
    if (node.type === "folder") {
      const nested = findSiblingNodes(node.children, parentPath);
      if (nested) return nested;
    }
  }
  return null;
}

export function sortablePageIds(nodes: KbTreeNode[]): string[] {
  return nodes.filter((node) => node.type === "page").map((node) => node.path);
}

export function parentPathOf(pagePath: string): string {
  const segments = pagePath.split("/");
  if (segments.length <= 1) return "";
  return segments.slice(0, -1).join("/");
}
