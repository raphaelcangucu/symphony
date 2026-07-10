import { describe, expect, it } from "vitest";

import { collectChangedDocEntries, collectChangedDocPaths } from "@/lib/changedDocPaths";
import type { GitDiffResult } from "@/types/gitDiff";

function diff(repos: GitDiffResult["repos"]): GitDiffResult {
  return {
    repos,
    workspace: { path: "/tmp/ws", available: true },
  };
}

describe("collectChangedDocPaths", () => {
  it("collects docs-relative paths from all repos and ignores non-docs", () => {
    const paths = collectChangedDocPaths(
      diff([
        {
          repo: "front",
          files: [
            {
              path: "docs/superpowers/specs/settlement.md",
              oldPath: null,
              status: "modified",
              patch: "",
            },
            {
              path: "src/app.ts",
              oldPath: null,
              status: "modified",
              patch: "",
            },
          ],
        },
        {
          repo: "back",
          files: [
            {
              path: "docs/market/omnibus.md",
              oldPath: null,
              status: "added",
              patch: "",
            },
          ],
        },
      ]),
    );

    expect(paths).toEqual(["superpowers/specs/settlement.md", "market/omnibus.md"]);
  });

  it("includes rename old_path when under docs/", () => {
    const paths = collectChangedDocPaths(
      diff([
        {
          repo: "front",
          files: [
            {
              path: "docs/new-name.md",
              oldPath: "docs/old-name.md",
              status: "renamed",
              patch: "",
            },
          ],
        },
      ]),
    );

    expect(paths).toEqual(["new-name.md", "old-name.md"]);
  });

  it("returns empty for empty diff", () => {
    expect(collectChangedDocPaths(diff([]))).toEqual([]);
  });

  it("dedupes paths across repos and path/oldPath", () => {
    const paths = collectChangedDocPaths(
      diff([
        {
          repo: "front",
          files: [
            {
              path: "docs/same.md",
              oldPath: "docs/same.md",
              status: "modified",
              patch: "",
            },
          ],
        },
        {
          repo: "back",
          files: [
            {
              path: "docs/same.md",
              oldPath: null,
              status: "modified",
              patch: "",
            },
          ],
        },
      ]),
    );

    expect(paths).toEqual(["same.md"]);
  });

  it("keeps repo association for synthetic tree insertion", () => {
    const entries = collectChangedDocEntries(
      diff([
        {
          repo: "back",
          files: [
            {
              path: "docs/superpowers/specs/settlement.md",
              oldPath: null,
              status: "added",
              patch: "",
            },
          ],
        },
        {
          repo: "front",
          files: [
            {
              path: "docs/guide.md",
              oldPath: null,
              status: "modified",
              patch: "",
            },
          ],
        },
      ]),
    );

    expect(entries).toEqual([
      { repo: "back", path: "superpowers/specs/settlement.md" },
      { repo: "front", path: "guide.md" },
    ]);
  });
});
