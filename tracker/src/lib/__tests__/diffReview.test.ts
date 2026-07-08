import { describe, expect, it } from "vitest";

import { buildDiffReviewPrompt, lineTextFromPatch, type DiffReviewComment } from "@/lib/diffReview";

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
      },
      {
        id: "2",
        filePath: "backend/src/auth.ts",
        side: "deletions",
        lineNumber: 10,
        lineText: null,
        comment: "Why was this removed?",
      },
      {
        id: "3",
        filePath: "frontend/src/App.tsx",
        side: "additions",
        lineNumber: 5,
        lineText: "useEffect(() => {",
        comment: "Missing dependency array.",
      },
    ];

    const prompt = buildDiffReviewPrompt(comments);

    expect(prompt).toContain("### backend/src/auth.ts");
    expect(prompt).toContain("### frontend/src/App.tsx");
    expect(prompt.indexOf("line 10 (removed)")).toBeLessThan(prompt.indexOf("line 42"));
    expect(prompt).toContain("> const token = raw;");
    expect(prompt).toContain("Validate the token before using it.");
    expect(prompt).toContain("Address each one");
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
      },
    ]);

    expect(prompt).toContain("  First line.\n  Second line.");
  });
});
