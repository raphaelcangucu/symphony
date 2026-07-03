import { describe, expect, it } from "vitest";

import { buildGitDiffTree } from "@/lib/gitDiffTree";
import type { GitDiffFileChange } from "@/types/gitDiff";

function file(path: string): GitDiffFileChange {
  return { path, oldPath: null, status: "modified", patch: "" };
}

describe("gitDiffTree", () => {
  it("builds folders before files and compacts single-child folders", () => {
    const tree = buildGitDiffTree([
      file("README.md"),
      file("src/components/Button.tsx"),
      file("src/App.tsx"),
      file("test/a.test.ts"),
    ]);

    expect(tree.map((node) => `${node.type}:${node.name}`)).toEqual([
      "folder:src",
      "folder:test",
      "file:README.md",
    ]);
    expect(tree[0].children.map((node) => `${node.type}:${node.name}`)).toEqual([
      "folder:components",
      "file:App.tsx",
    ]);
    expect(tree[1].name).toBe("test");
  });
});
