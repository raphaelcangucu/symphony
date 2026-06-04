import { describe, expect, it, beforeEach } from "vitest";

import {
  buildPreviewFailurePrompt,
  consumePreviewAssistantHandoff,
  previewHandoffTarget,
  stashPreviewAssistantHandoff,
} from "@/lib/previewAssistantHandoff";
import type { IssueDevServer } from "@/types/issue";

describe("previewAssistantHandoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("builds a diagnostic prompt from server state", () => {
    const server: IssueDevServer = {
      id: 1,
      slug: "web",
      status: "crashed",
      url: null,
      port: 4100,
      primary: true,
      session_name: "sym-issue-macro-markets-510-web",
      working_dir: "front",
    };

    const prompt = buildPreviewFailurePrompt(
      { available: true, reason: null, servers: [server] },
      server,
    );

    expect(prompt).toContain("preview dev server failed");
    expect(prompt).toContain("web");
    expect(prompt).toContain("crashed");
    expect(prompt).toContain("sym-issue-macro-markets-510-web");
    expect(prompt).toContain("tmux capture-pane");
  });

  it("stashes and consumes handoff for the matching issue", () => {
    stashPreviewAssistantHandoff({
      projectSlug: "macro-markets",
      issueIdentifier: "510",
      target: "authoring",
      message: "fix preview",
      createdAt: Date.now(),
    });

    expect(consumePreviewAssistantHandoff("macro-markets", "510")).toEqual({
      projectSlug: "macro-markets",
      issueIdentifier: "510",
      target: "authoring",
      message: "fix preview",
      createdAt: expect.any(Number),
    });

    expect(consumePreviewAssistantHandoff("macro-markets", "510")).toBeNull();
  });

  it("prefers execution steer when an agent run is live", () => {
    expect(previewHandoffTarget({ status: "live" } as never)).toBe("execution-steer");
    expect(previewHandoffTarget(undefined)).toBe("authoring");
  });
});
