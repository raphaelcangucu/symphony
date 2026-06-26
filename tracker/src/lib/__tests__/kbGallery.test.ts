import { describe, expect, it } from "vitest";

import { collectKbImageAssets } from "@/lib/kbGallery";
import type { KbTreeNode } from "@/types/knowledgeBase";

function node(partial: Partial<KbTreeNode> & Pick<KbTreeNode, "type" | "name" | "path">): KbTreeNode {
  return {
    title: partial.title ?? partial.name,
    order: null,
    favorite: false,
    children: [],
    ...partial,
  };
}

describe("collectKbImageAssets", () => {
  it("collects image assets recursively, sorted by name, skipping non-images", () => {
    const tree: KbTreeNode[] = [
      node({
        type: "folder",
        name: "assets",
        path: "assets",
        children: [
          node({ type: "asset", name: "queue.png", path: "assets/queue.png", title: "queue" }),
          node({ type: "asset", name: "diagram.svg", path: "assets/diagram.svg", title: "diagram" }),
          node({ type: "asset", name: "notes.pdf", path: "assets/notes.pdf", title: "notes" }),
        ],
      }),
      node({ type: "page", name: "intro.md", path: "intro.md", title: "Intro" }),
      node({
        type: "folder",
        name: "guides",
        path: "guides",
        children: [
          node({ type: "asset", name: "alpha.jpg", path: "guides/assets/alpha.jpg", title: "alpha" }),
        ],
      }),
    ];

    const result = collectKbImageAssets(tree);

    expect(result.map((asset) => asset.path)).toEqual([
      "guides/assets/alpha.jpg",
      "assets/diagram.svg",
      "assets/queue.png",
    ]);
    expect(result.map((asset) => asset.name)).toEqual(["alpha", "diagram", "queue"]);
  });

  it("returns an empty list when there are no image assets", () => {
    const tree: KbTreeNode[] = [node({ type: "page", name: "home.md", path: "home.md", title: "Home" })];
    expect(collectKbImageAssets(tree)).toEqual([]);
  });
});
