import { describe, expect, it } from "vitest";

import { enrichGuidanceWithAttachments } from "@/lib/enrichComposerGuidance";

describe("enrichGuidanceWithAttachments", () => {
  it("embeds image markdown for image attachments", () => {
    const message = enrichGuidanceWithAttachments(
      "check this",
      [{ type: "image", name: "shot.png", media_type: "image/png", path: "uploads/shot.png" }],
      "advising",
    );

    expect(message).toContain("check this");
    expect(message).toContain("![shot.png]");
    expect(message).toContain("/api/tracker/v1/projects/advising/assistant/attachments/uploads/shot.png");
  });

  it("inlines text file contents when provided", () => {
    const message = enrichGuidanceWithAttachments(
      "review",
      [{ type: "file", name: "notes.txt", media_type: "text/plain", path: "uploads/notes.txt" }],
      "advising",
      { "uploads/notes.txt": "hello world" },
    );

    expect(message).toContain("<<<BEGIN FILE notes.txt>>>");
    expect(message).toContain("hello world");
  });
});
