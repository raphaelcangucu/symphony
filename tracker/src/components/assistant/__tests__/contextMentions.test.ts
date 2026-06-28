import { describe, expect, it } from "vitest";

import {
  expandComposerMentions,
  mentionToken,
  parseMentionTokens,
} from "@/components/assistant/contextMentions";

describe("contextMentions", () => {
  it("formats and parses tokens", () => {
    expect(mentionToken({ type: "issue", id: "DEMO-12" })).toBe("@issue:DEMO-12");
    expect(mentionToken({ type: "file", id: "lib/a.ex" })).toBe("@file:lib/a.ex");
    expect(mentionToken({ type: "pr", id: "123" })).toBe("@pr:123");

    expect(parseMentionTokens("see @issue:DEMO-12 and @file:lib/a.ex")).toEqual([
      { type: "issue", id: "DEMO-12" },
      { type: "file", id: "lib/a.ex" },
    ]);
  });

  it("dedupes repeated tokens while preserving order", () => {
    expect(parseMentionTokens("@pr:9 @issue:A @pr:9")).toEqual([
      { type: "pr", id: "9" },
      { type: "issue", id: "A" },
    ]);
  });

  it("appends a Context block on expansion", () => {
    const out = expandComposerMentions("fix @issue:DEMO-12", [
      { type: "issue", id: "DEMO-12", label: "DEMO-12 Login bug", detail: "Open" },
    ]);
    expect(out).toContain("fix @issue:DEMO-12");
    expect(out).toContain("## Context");
    expect(out).toContain("Issue DEMO-12");
    expect(out).toContain("Login bug");
  });

  it("enumerates files and PRs", () => {
    const out = expandComposerMentions("@file:lib/a.ex @pr:42", [
      { type: "file", id: "lib/a.ex" },
      { type: "pr", id: "42", label: "Add caching" },
    ]);
    expect(out).toContain("File lib/a.ex");
    expect(out).toContain("PR #42");
    expect(out).toContain("Add caching");
  });

  it("passes text through unchanged when nothing is resolved", () => {
    expect(expandComposerMentions("plain text", [])).toBe("plain text");
  });
});
