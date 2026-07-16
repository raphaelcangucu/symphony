import { describe, expect, it } from "vitest";

import {
  findGitDiffEntriesForPath,
  gitDiffPathBaseName,
  pickBestGitDiffEntry,
} from "@/lib/gitDiffPathMatch";
import type { GitDiffFileEntry } from "@/types/gitDiff";

function entry(repo: string, path: string): GitDiffFileEntry {
  return {
    repo,
    path,
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
  };
}

describe("gitDiffPathMatch", () => {
  it("matches absolute workspace paths ending with repo/path", () => {
    const files = [entry("back", "docs/index.md")];
    const matches = findGitDiffEntriesForPath(
      files,
      "/tmp/symphony_workspaces/macro-markets/back/docs/index.md",
    );
    expect(matches).toEqual([files[0]]);
  });

  it("picks the longest/most specific match when several apply", () => {
    const files = [entry("app", "index.md"), entry("app", "docs/index.md")];
    const best = pickBestGitDiffEntry(files, "/ws/app/docs/index.md");
    expect(best?.path).toBe("docs/index.md");
  });

  it("returns basename for filter queries", () => {
    expect(gitDiffPathBaseName("/tmp/ws/back/docs/index.md")).toBe("index.md");
  });
});
