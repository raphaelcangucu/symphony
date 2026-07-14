import type { GitDiffFileTreeEntry } from "@/types/gitDiff";

export interface GitDiffTreeNode {
  id: string;
  name: string;
  path: string;
  type: "folder" | "file";
  children: GitDiffTreeNode[];
  file?: GitDiffFileTreeEntry;
}

export function buildGitDiffTree(files: GitDiffFileTreeEntry[]): GitDiffTreeNode[] {
  const root = new Map<string, GitDiffTreeNode>();

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    let currentPath = "";

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      const existing = current.get(part);

      if (existing) {
        if (isFile) existing.file = file;
        current = childMap(existing);
        return;
      }

      const node: GitDiffTreeNode = {
        id: currentPath,
        name: part,
        path: currentPath,
        type: isFile ? "file" : "folder",
        children: [],
        ...(isFile ? { file } : {}),
      };

      current.set(part, node);
      current = childMap(node);
    });
  }

  return sortNodes(Array.from(root.values())).map(compactFolder);
}

function childMap(node: GitDiffTreeNode): Map<string, GitDiffTreeNode> {
  const map = new Map<string, GitDiffTreeNode>();
  for (const child of node.children) map.set(child.name, child);

  const originalPush = node.children.push.bind(node.children);
  // Keep a simple map-like facade by replacing set below through caller's map.
  void originalPush;
  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: GitDiffTreeNode) => {
      map.set(key, value);
      node.children = sortNodes(Array.from(map.values()));
      return map;
    },
    values: () => map.values(),
  } as Map<string, GitDiffTreeNode>;
}

function sortNodes(nodes: GitDiffTreeNode[]): GitDiffTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function compactFolder(node: GitDiffTreeNode): GitDiffTreeNode {
  if (node.type === "file") return node;

  let compacted = {
    ...node,
    children: node.children.map(compactFolder),
  };

  while (
    compacted.children.length === 1 &&
    compacted.children[0].type === "folder" &&
    !compacted.file
  ) {
    const child = compacted.children[0];
    compacted = {
      ...child,
      id: child.id,
      name: `${compacted.name}/${child.name}`,
      path: child.path,
    };
  }

  return compacted;
}
