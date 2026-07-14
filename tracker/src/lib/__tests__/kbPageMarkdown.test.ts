import { describe, expect, it } from "vitest";

import { kbPageDownloadFilename, serializeKbPageMarkdown } from "@/lib/kbPageMarkdown";

describe("serializeKbPageMarkdown", () => {
  it("returns body only when frontmatter is empty", () => {
    expect(serializeKbPageMarkdown({}, "# Title\n\nbody")).toBe("# Title\n\nbody");
  });

  it("wraps frontmatter in YAML fences", () => {
    expect(
      serializeKbPageMarkdown({ title: "Vibe", favorite: true, order: 2 }, "# Vibe\n\nbody"),
    ).toBe("---\ntitle: Vibe\nfavorite: true\norder: 2\n---\n# Vibe\n\nbody");
  });
});

describe("kbPageDownloadFilename", () => {
  it("uses the last path segment", () => {
    expect(kbPageDownloadFilename("agent panel/VIBE.md")).toBe("VIBE.md");
  });

  it("falls back to page.md", () => {
    expect(kbPageDownloadFilename("")).toBe("page.md");
  });
});
