import { describe, expect, it } from "vitest";

import { extractNotionUrls } from "@/lib/notionUrl";

describe("extractNotionUrls", () => {
  it("finds notion.so URLs in text", () => {
    const text = "see https://www.notion.so/abc123def4567890abc123def4567890 please";
    expect(extractNotionUrls(text)[0]).toContain("notion.so");
  });

  it("returns empty for non-notion links", () => {
    expect(extractNotionUrls("https://example.com")).toEqual([]);
  });

  it("trims trailing punctuation from matched URLs", () => {
    const text = "Open (https://notion.so/Workspace/Page-abc123def4567890abc123def4567890).";
    expect(extractNotionUrls(text)).toEqual([
      "https://notion.so/Workspace/Page-abc123def4567890abc123def4567890",
    ]);
  });

  it("finds multiple Notion URLs", () => {
    const text =
      "a https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and https://notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(extractNotionUrls(text)).toHaveLength(2);
  });
});
