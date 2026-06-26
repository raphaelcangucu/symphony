import { describe, expect, it } from "vitest";

import { computeInsertOrder } from "@/lib/kbTreeActions";
import type { KbTreeNode } from "@/types/knowledgeBase";

function page(path: string, order: number | null): KbTreeNode {
  return {
    type: "page",
    name: `${path}.md`,
    path,
    title: path,
    order,
    favorite: false,
    children: [],
  };
}

describe("computeInsertOrder", () => {
  it("returns 10 for an empty sibling list", () => {
    expect(computeInsertOrder([], null)).toBe(10);
  });

  it("inserts before existing pages at the first position", () => {
    const pages = [page("b", 20), page("c", 30)];
    expect(computeInsertOrder(pages, null)).toBe(10);
  });

  it("inserts after a specific page", () => {
    const pages = [page("a", 10), page("b", 20), page("c", 30)];
    expect(computeInsertOrder(pages, "a")).toBe(15);
    expect(computeInsertOrder(pages, "b")).toBe(25);
    expect(computeInsertOrder(pages, "c")).toBe(40);
  });
});
