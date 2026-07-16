import { describe, expect, it } from "vitest";

import { sessionPairToTyped } from "@/components/issues/issue-detail/sessionToolCall";
import type { SessionLogEntry } from "@/types/session-log";

function entry(partial: Partial<SessionLogEntry>): SessionLogEntry {
  return {
    kind: "event",
    title: "",
    body: null,
    language: "text",
    status: null,
    collapsed: false,
    callId: null,
    ...partial,
  };
}

describe("sessionPairToTyped", () => {
  it("session pair for Bash produces command presentation with description title", () => {
    const pair = {
      call: entry({
        kind: "tool_call",
        title: "Bash",
        body: JSON.stringify({
          description: "Run GranteeAutocomplete unit tests",
          command: "yarn test foo",
        }),
        callId: "c1",
        language: "bash",
        status: "running",
      }),
      result: entry({
        kind: "tool_result",
        title: "Bash",
        body: JSON.stringify({ success: { exitCode: 0, stdout: "PASS" } }),
        callId: "c1",
        status: "completed",
      }),
    };

    const { presentation } = sessionPairToTyped(pair);
    expect(presentation.family).toBe("command");
    expect(presentation.title).toBe("Run GranteeAutocomplete unit tests");
  });
});
