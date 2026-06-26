import { arrayMove } from "@dnd-kit/sortable";

import { slugifyPageName, uniquePagePath } from "@/lib/kbRoutes";
import { findSiblingNodes } from "@/lib/kbTreeUtils";
import { createPage, deletePage, getPage, savePage } from "@/services/knowledgeBase";
import type { KbTreeNode } from "@/types/knowledgeBase";


function pageSortOrder(node: KbTreeNode, index: number): number {
  return node.order ?? (index + 1) * 10;
}

export function computeInsertOrder(pages: KbTreeNode[], insertAfterPath: string | null): number {
  if (pages.length === 0) return 10;

  if (insertAfterPath === null) {
    const orders = pages.map((page, index) => pageSortOrder(page, index));
    return Math.max(1, Math.min(...orders) - 10);
  }

  const index = pages.findIndex((page) => page.path === insertAfterPath);
  if (index === -1) return (pages.length + 1) * 10;

  const currentOrder = pageSortOrder(pages[index], index);
  const next = pages[index + 1];
  if (!next) return currentOrder + 10;

  const nextOrder = pageSortOrder(next, index + 1);
  if (nextOrder <= currentOrder + 1) return currentOrder + 1;
  return Math.floor((currentOrder + nextOrder) / 2);
}

export async function reorderPages(
  projectSlug: string,
  repoSlug: string,
  tree: KbTreeNode[],
  parentPath: string,
  activePath: string,
  overPath: string,
): Promise<void> {
  const siblings = findSiblingNodes(tree, parentPath);
  if (!siblings) return;

  const pages = siblings.filter((node) => node.type === "page");
  const oldIndex = pages.findIndex((node) => node.path === activePath);
  const newIndex = pages.findIndex((node) => node.path === overPath);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

  const reordered = arrayMove(pages, oldIndex, newIndex);
  await Promise.all(
    reordered.map(async (node, index) => {
      const page = await getPage(projectSlug, repoSlug, node.path);
      const nextOrder = (index + 1) * 10;
      if (page.frontmatter.order === nextOrder) return;
      await savePage(projectSlug, repoSlug, node.path, {
        frontmatter: { ...page.frontmatter, order: nextOrder },
        body: page.body,
      });
    }),
  );
}

export async function togglePageFavorite(
  projectSlug: string,
  repoSlug: string,
  path: string,
  favorite: boolean,
): Promise<void> {
  const page = await getPage(projectSlug, repoSlug, path);
  await savePage(projectSlug, repoSlug, path, {
    frontmatter: { ...page.frontmatter, favorite: !favorite },
    body: page.body,
  });
}

export async function renamePageTitle(
  projectSlug: string,
  repoSlug: string,
  path: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const page = await getPage(projectSlug, repoSlug, path);
  await savePage(projectSlug, repoSlug, path, {
    frontmatter: { ...page.frontmatter, title: trimmed },
    body: page.body,
  });
}

export async function removePage(projectSlug: string, repoSlug: string, path: string): Promise<void> {
  await deletePage(projectSlug, repoSlug, path);
}

export async function createFolderPage(
  projectSlug: string,
  repoSlug: string,
  tree: KbTreeNode[],
  parentPath: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Folder name is required");
  const folderSlug = slugifyPageName(trimmed);
  const dir = parentPath ? `${parentPath}/${folderSlug}` : folderSlug;
  const path = `${dir}/index.md`;
  const existing = collectPathsUnder(tree, parentPath);
  if (existing.includes(path)) throw new Error("Folder already exists");
  await createPage(projectSlug, repoSlug, path, trimmed);
  return path;
}

export async function createChildPage(
  projectSlug: string,
  repoSlug: string,
  tree: KbTreeNode[],
  parentPath: string,
  title: string,
  insertAfterPath: string | null = null,
): Promise<string> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Page title is required");
  const siblings = findSiblingNodes(tree, parentPath) ?? tree;
  const pages = siblings.filter((node) => node.type === "page");
  const existing = siblings.map((node) => node.path);
  const path = uniquePagePath(existing, parentPath, trimmed);
  const order = computeInsertOrder(pages, insertAfterPath);
  await savePage(projectSlug, repoSlug, path, {
    frontmatter: { title: trimmed, order },
    body: `# ${trimmed}\n`,
  });
  return path;
}

function collectPathsUnder(tree: KbTreeNode[], parentPath: string): string[] {
  const siblings = findSiblingNodes(tree, parentPath) ?? tree;
  return siblings.flatMap((node) => [node.path, ...collectPagePathsRecursive(node.children)]);
}

function collectPagePathsRecursive(nodes: KbTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.path, ...collectPagePathsRecursive(node.children)]);
}
