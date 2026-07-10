import { describe, expect, it } from "vitest";

import { filterKbTreesByPaths, insertSyntheticKbPage } from "@/lib/kbTreeFilter";
import type { KbTreeNode } from "@/types/knowledgeBase";

const tree: KbTreeNode[] = [
  {
    type: "folder",
    name: "market",
    path: "market",
    title: "Market",
    order: null,
    favorite: false,
    children: [
      {
        type: "page",
        name: "omnibus.md",
        path: "market/omnibus.md",
        title: "Omnibus",
        order: null,
        favorite: false,
        children: [],
      },
      {
        type: "page",
        name: "other.md",
        path: "market/other.md",
        title: "Other",
        order: null,
        favorite: false,
        children: [],
      },
    ],
  },
];

describe("kbTreeFilter", () => {
  it("prunes the tree to matching paths", () => {
    const filtered = filterKbTreesByPaths({ back: tree }, new Set(["market/omnibus.md"]));
    expect(filtered.back).toEqual([
      {
        ...tree[0],
        children: [tree[0].children[0]],
      },
    ]);
  });

  it("inserts a synthetic page for a missing path", () => {
    const next = insertSyntheticKbPage([], "superpowers/specs/new.md");
    expect(next).toEqual([
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
                name: "new.md",
                path: "superpowers/specs/new.md",
                title: "New",
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
