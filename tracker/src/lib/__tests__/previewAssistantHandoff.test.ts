import { describe, expect, it, beforeEach } from "vitest";

import { i18n } from "@/i18n";
import {
  buildPreviewFailurePrompt,
  buildWarmUpBootstrapPrompt,
  consumePreviewAssistantHandoff,
  consumeProjectAssistantHandoff,
  previewHandoffTarget,
  stashPreviewAssistantHandoff,
  stashProjectAssistantHandoff,
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

    expect(prompt).toContain(i18n.t("issue.preview.failurePrompt.intro"));
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

  it("stashes and consumes a project warm-up handoff (single-use)", () => {
    stashProjectAssistantHandoff({ projectSlug: "adv", message: "Prepare env", createdAt: Date.now() });

    expect(consumeProjectAssistantHandoff("adv")?.message).toBe("Prepare env");
    expect(consumeProjectAssistantHandoff("adv")).toBeNull();
  });

  it("ignores a project handoff for a different project", () => {
    stashProjectAssistantHandoff({ projectSlug: "adv", message: "Prepare env", createdAt: Date.now() });
    expect(consumeProjectAssistantHandoff("other")).toBeNull();
  });

  it("builds a warm-up bootstrap prompt mentioning the project and the tool", () => {
    const prompt = buildWarmUpBootstrapPrompt("adv");
    expect(prompt).toContain("adv");
    expect(prompt).toContain("manage_dev_env");
    expect(prompt).toContain("warm_up");
  });

  it("instructs the agent to ask the user for missing credentials instead of guessing", () => {
    const prompt = buildWarmUpBootstrapPrompt("adv");
    expect(prompt).toContain("ASK THE USER");
    expect(prompt).toContain("needs_user_input");
    expect(prompt).toMatch(/never invent, guess/i);
    expect(prompt).toContain("AWS credentials");
  });

  it("guides the db_not_seeded failure to gh auth + ensure-tenant-db without fabricating data", () => {
    const prompt = buildWarmUpBootstrapPrompt("adv");
    expect(prompt).toContain("db_not_seeded");
    expect(prompt).toContain("gh auth login");
    expect(prompt).toContain("ensure-tenant-db.sh");
    expect(prompt).toMatch(/never fabricate/i);
  });
});
