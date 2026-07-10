import { describe, expect, it } from "vitest";

import { withSyntheticChangedPages } from "@/lib/kbTreeFilter";
import type { KbTreeNode } from "@/types/knowledgeBase";

const emptyTrees = { back: [] as KbTreeNode[], front: [] as KbTreeNode[] };

describe("withSyntheticChangedPages multi-repo", () => {
  it("inserts missing changed pages into the owning repo even when multiple repos exist", () => {
    const next = withSyntheticChangedPages(emptyTrees, ["back", "front"], [
      { repo: "back", path: "superpowers/specs/settlement.md" },
    ]);

    expect(next.front).toEqual([]);
    expect(next.back).toEqual([
      {
        type: "folder",
        name: "superpowers",
        path: "superpowers",
        title: "Superpowers",
        order: null,
        favorite: false,
        children: [
          {
            type: "folder",
            name: "specs",
            path: "superpowers/specs",
            title: "Specs",
            order: null,
            favorite: false,
            children: [
              {
                type: "page",
                name: "settlement.md",
                path: "superpowers/specs/settlement.md",
                title: "Settlement",
                order: null,
                favorite: false,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });
});
