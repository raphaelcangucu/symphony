import { describe, expect, it } from "vitest";

import {
  buildDiffReviewPrompt,
  lineTextFromPatch,
  type CommitNote,
  type DiffReviewComment,
} from "@/lib/diffReview";

const PATCH = [
  "@@ -10,4 +10,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 20;",
  "+const c = 3;",
  " export { a, b };",
  "@@ -30,2 +31,2 @@",
  "-old line",
  "+new line",
  "",
].join("\n");

describe("lineTextFromPatch", () => {
  it("resolves added lines by new-file line number", () => {
    expect(lineTextFromPatch(PATCH, "additions", 11)).toBe("const b = 20;");
    expect(lineTextFromPatch(PATCH, "additions", 12)).toBe("const c = 3;");
    expect(lineTextFromPatch(PATCH, "additions", 31)).toBe("new line");
  });

  it("resolves removed lines by old-file line number", () => {
    expect(lineTextFromPatch(PATCH, "deletions", 11)).toBe("const b = 2;");
    expect(lineTextFromPatch(PATCH, "deletions", 30)).toBe("old line");
  });

  it("resolves context lines on both sides", () => {
    expect(lineTextFromPatch(PATCH, "additions", 10)).toBe("const a = 1;");
    expect(lineTextFromPatch(PATCH, "deletions", 10)).toBe("const a = 1;");
  });

  it("returns null for lines outside the patch", () => {
    expect(lineTextFromPatch(PATCH, "additions", 999)).toBeNull();
    expect(lineTextFromPatch("", "additions", 1)).toBeNull();
  });
});

describe("buildDiffReviewPrompt", () => {
  it("groups comments by file, sorts by line, and anchors code lines", () => {
    const comments: DiffReviewComment[] = [
      {
        id: "1",
        filePath: "backend/src/auth.ts",
        side: "additions",
        lineNumber: 42,
        lineText: "const token = raw;",
        comment: "Validate the token before using it.",
        source: "uncommitted",
      },
      {
        id: "2",
        filePath: "backend/src/auth.ts",
        side: "deletions",
        lineNumber: 10,
        lineText: null,
        comment: "Why was this removed?",
        source: "uncommitted",
      },
      {
        id: "3",
        filePath: "frontend/src/App.tsx",
        side: "additions",
        lineNumber: 5,
        lineText: "useEffect(() => {",
        comment: "Missing dependency array.",
        source: "branch",
      },
    ];

    const prompt = buildDiffReviewPrompt(comments);

    expect(prompt).toContain("### (working tree) — backend/src/auth.ts");
    expect(prompt).toContain("### (branch) — frontend/src/App.tsx");
    expect(prompt.indexOf("line 10 (removed)")).toBeLessThan(prompt.indexOf("line 42"));
    expect(prompt).toContain("> const token = raw;");
    expect(prompt).toContain("Validate the token before using it.");
    expect(prompt).toContain("Address each");
  });

  it("indents multi-line comments so they stay inside the list item", () => {
    const prompt = buildDiffReviewPrompt([
      {
        id: "1",
        filePath: "a.ts",
        side: "additions",
        lineNumber: 1,
        lineText: null,
        comment: "First line.\nSecond line.",
        source: "uncommitted",
      },
    ]);

    expect(prompt).toContain("  First line.\n  Second line.");
  });

  it("includes commit notes and commit-sourced line comments", () => {
    const notes: CommitNote[] = [
      {
        repo: "front",
        sha: "a1b2c3d4e5f6",
        shortSha: "a1b2c3d",
        message: "docs: settlement plan",
        note: "use as settlement context",
      },
    ];
    const comments: DiffReviewComment[] = [
      {
        id: "1",
        filePath: "front/docs/plan.md",
        side: "additions",
        lineNumber: 12,
        lineText: "## Goal",
        comment: "call out cross-tenant",
        source: "commit",
        commitSha: "a1b2c3d4e5f6",
        commitRepo: "front",
      },
    ];

    const prompt = buildDiffReviewPrompt(comments, notes);

    expect(prompt).toContain("## Commit notes");
    expect(prompt).toContain("### front @ a1b2c3d — docs: settlement plan");
    expect(prompt).toContain("use as settlement context");
    expect(prompt).toContain("## Line comments");
    expect(prompt).toContain("### front @ a1b2c3d — front/docs/plan.md");
    expect(prompt).toContain("call out cross-tenant");
  });

  it("omits empty commit-notes section and ignores whitespace-only notes", () => {
    const prompt = buildDiffReviewPrompt([], [
      { repo: "front", sha: "abc", shortSha: "abc", message: "x", note: "   " },
    ]);
    expect(prompt).not.toContain("## Commit notes");
    expect(prompt).toContain("Address each");
  });
});
