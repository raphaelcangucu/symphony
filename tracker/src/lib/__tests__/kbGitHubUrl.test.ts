import { describe, expect, it } from "vitest";

import { buildKbGitHubFileUrl } from "@/lib/kbGitHubUrl";

describe("buildKbGitHubFileUrl", () => {
  it("builds a blob URL under docs/", () => {
    expect(buildKbGitHubFileUrl("civitaslearning/advising", "VIBE.md", "main")).toBe(
      "https://github.com/civitaslearning/advising/blob/main/docs/VIBE.md",
    );
  });

  it("encodes nested paths and branches", () => {
    expect(buildKbGitHubFileUrl("acme/web", "agent panel/setup.md", "pre-release")).toBe(
      "https://github.com/acme/web/blob/pre-release/docs/agent%20panel/setup.md",
    );
  });

  it("returns null without a GitHub repository", () => {
    expect(buildKbGitHubFileUrl(null, "VIBE.md")).toBeNull();
    expect(buildKbGitHubFileUrl("", "VIBE.md")).toBeNull();
  });
});
