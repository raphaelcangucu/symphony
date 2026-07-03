import { describe, expect, it, vi } from "vitest";

import { openTerminalSession, projectTerminalTopic, terminalTopic } from "@/services/terminal";
import { http } from "@/services/http";

describe("terminal service", () => {
  it("opens an issue terminal session through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          project_slug: "macro-markets",
          issue_identifier: "MAC-1",
          state: "running",
          session_name: "sym-issue-macro-markets-MAC-1",
          cwd: "/tmp/symphony-workspaces/macro-markets-MAC-1",
          channel_topic: "terminal:macro-markets:MAC-1",
        },
      },
    });

    const session = await openTerminalSession("macro-markets", "MAC-1");

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects/macro-markets/issues/MAC-1/terminal");
    expect(session).toEqual({
      issueIdentifier: "MAC-1",
      projectSlug: "macro-markets",
      state: "running",
      sessionName: "sym-issue-macro-markets-MAC-1",
      cwd: "/tmp/symphony-workspaces/macro-markets-MAC-1",
      channelTopic: "terminal:macro-markets:MAC-1",
      message: null,
    });
  });

  it("builds terminal topics with validation", () => {
    expect(terminalTopic("macro-markets", "MAC-1")).toBe("terminal:macro-markets:MAC-1");
    expect(projectTerminalTopic("macro-markets")).toBe("terminal:devenv:macro-markets");
    expect(() => terminalTopic(" ", "MAC-1")).toThrow(/projectSlug/);
    expect(() => terminalTopic("macro-markets", " ")).toThrow(/issueIdentifier/);
    expect(() => projectTerminalTopic(" ")).toThrow(/projectSlug/);
  });
});
