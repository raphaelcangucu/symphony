import { describe, expect, it, vi } from "vitest";

import { handleAssistantEvent } from "./assistant-session";

describe("assistant session metadata", () => {
  it("keeps the task association supplied by a reopened session", () => {
    const onAction = vi.fn();

    handleAssistantEvent(
      "joined",
      {
        project_slug: "vinext-health",
        issue_identifier: "VIN-9",
        effective_agent: "codex",
      },
      onAction,
    );

    expect(onAction).toHaveBeenCalledWith({
      type: "session_metadata",
      metadata: expect.objectContaining({
        projectSlug: "vinext-health",
        issueIdentifier: "VIN-9",
      }),
      preferences: expect.objectContaining({}),
    });
  });
});
