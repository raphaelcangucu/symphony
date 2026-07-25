import type { GitDiffFileEntry } from "@/api/contracts";
import { describe, expect, it } from "vitest";

import { groupDiffFiles, parsePatchLines } from "./diff-state";

describe("diff state", () => {
  it("groups lightweight file metadata by repository without loading patches", () => {
    const files: GitDiffFileEntry[] = [
      {
        repo: "mobile",
        path: "src/App.tsx",
        oldPath: null,
        status: "modified",
        additions: 4,
        deletions: 1,
        binary: false,
      },
      {
        repo: "api",
        path: "lib/app.ex",
        oldPath: null,
        status: "added",
        additions: 12,
        deletions: 0,
        binary: false,
      },
      {
        repo: "mobile",
        path: "assets/logo.png",
        oldPath: null,
        status: "modified",
        additions: null,
        deletions: null,
        binary: true,
      },
    ];

    expect(groupDiffFiles(files)).toEqual([
      { repo: "api", files: [files[1]] },
      { repo: "mobile", files: [files[0], files[2]] },
    ]);
  });

  it("classifies unified patch headers separately from additions and deletions", () => {
    expect(
      parsePatchLines(
        "diff --git a/App.tsx b/App.tsx\n--- a/App.tsx\n+++ b/App.tsx\n@@ -1,2 +1,2 @@\n-old\n+new\n unchanged",
      ),
    ).toEqual([
      { kind: "meta", text: "diff --git a/App.tsx b/App.tsx" },
      { kind: "meta", text: "--- a/App.tsx" },
      { kind: "meta", text: "+++ b/App.tsx" },
      { kind: "hunk", text: "@@ -1,2 +1,2 @@" },
      { kind: "deletion", text: "-old" },
      { kind: "addition", text: "+new" },
      { kind: "context", text: " unchanged" },
    ]);
  });
});
