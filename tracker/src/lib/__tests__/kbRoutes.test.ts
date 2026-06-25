import { describe, expect, it } from "vitest";
import {
  decodeRepoSlug,
  encodeRepoSlug,
  kbGeneralPagePath,
  kbGeneralPath,
  kbPagePath,
  kbProjectPath,
  kbRepoPath,
} from "@/lib/kbRoutes";

describe("kbRoutes", () => {
  it("encodes and decodes repo slugs round-trip (workspace path <-> slug)", () => {
    expect(encodeRepoSlug("services/api")).toBe("services~api");
    expect(decodeRepoSlug("services~api")).toBe("services/api");
    expect(encodeRepoSlug("web")).toBe("web");
  });

  it("builds the project KB base path", () => {
    expect(kbProjectPath("acme")).toBe("/projects/acme/kb");
  });

  it("builds a repo path using the URL-safe repo slug verbatim", () => {
    expect(kbRepoPath("acme", "services~api")).toBe("/projects/acme/kb/services~api");
  });

  it("builds a page path with the repo slug and encoded splat path", () => {
    expect(kbPagePath("acme", "services~api", "architecture/backend.md")).toBe(
      "/projects/acme/kb/services~api/architecture/backend.md",
    );
  });

  it("builds the general KB paths", () => {
    expect(kbGeneralPath()).toBe("/kb");
    expect(kbGeneralPagePath("notes/idea.md")).toBe("/kb/notes/idea.md");
  });
});
