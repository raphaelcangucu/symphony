import { isKbImageAssetPath } from "@/lib/kbAssets";
import type { KbTreeNode } from "@/types/knowledgeBase";

export interface KbGalleryAsset {
  /** Repo docs-root relative path, e.g. `assets/queue-config.png`. */
  path: string;
  /** Friendly display name derived from the file name. */
  name: string;
}

/**
 * Walks a repository tree and collects every image asset into a flat,
 * name-sorted list for the insert/replace gallery. The backend already exposes
 * asset files as `asset` tree nodes, so no extra request is needed.
 */
export function collectKbImageAssets(tree: KbTreeNode[]): KbGalleryAsset[] {
  const assets: KbGalleryAsset[] = [];

  const visit = (nodes: KbTreeNode[]): void => {
    for (const node of nodes) {
      if (node.type === "asset" && isKbImageAssetPath(node.path)) {
        assets.push({ path: node.path, name: node.title || node.name });
      }
      if (node.children.length > 0) visit(node.children);
    }
  };

  visit(tree);
  assets.sort((a, b) => a.name.localeCompare(b.name));
  return assets;
}
