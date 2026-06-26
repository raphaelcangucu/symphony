import { describe, expect, it } from "vitest";

import { pairSessionLogItems, sessionPairToView } from "@/components/issues/issue-detail/sessionToolCall";
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

describe("pairSessionLogItems", () => {
  it("merges a tool_call with its tool_result by callId", () => {
    const items = pairSessionLogItems([
      entry({ kind: "tool_call", title: "exec_command", body: '{"cmd":"pwd"}', language: "bash", status: "running", callId: "c1" }),
      entry({ kind: "tool_result", title: "Command output", body: "/home", status: "completed", callId: "c1" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "toolCall" });
    if (items[0].type !== "toolCall") throw new Error("expected toolCall");
    expect(items[0].call.callId).toBe("c1");
    expect(items[0].result?.body).toBe("/home");
  });

  it("renders an unpaired tool_call as running with no result", () => {
    const items = pairSessionLogItems([
      entry({ kind: "tool_call", title: "exec_command", body: '{"cmd":"pwd"}', language: "bash", status: "running", callId: "c2" }),
    ]);
    if (items[0].type !== "toolCall") throw new Error("expected toolCall");
    expect(items[0].result).toBeNull();
  });

  it("keeps legacy entries without callId as plain entries", () => {
    const items = pairSessionLogItems([entry({ kind: "tool_call", title: "legacy", body: "x", callId: null })]);
    expect(items[0].type).toBe("entry");
  });

  it("maps a paired bash call to a ToolCallView", () => {
    const view = sessionPairToView(
      entry({ kind: "tool_call", title: "exec_command", body: "pwd\nls", language: "bash", status: "running", callId: "c3" }),
      entry({ kind: "tool_result", title: "Command output", body: "/home", status: "completed", callId: "c3" }),
    );

    expect(view.toolType).toBe("Bash");
    expect(view.description).toBe("pwd");
    expect(view.input?.value).toBe("pwd\nls");
    expect(view.output?.value).toBe("/home");
    expect(view.status).toBe("completed");
    expect(view.defaultCollapsed).toBe(false);
  });

  it("labels a blocked glob error as Glob instead of Unknown", () => {
    const error =
      '{"error":{"error":"Glob pattern \\"**/*\\" matches every file and is not allowed. Use a more specific glob or no glob."}}';

    const view = sessionPairToView(
      entry({ kind: "tool_call", title: "unknown", body: null, language: "json", status: "running", callId: "c4" }),
      entry({ kind: "tool_result", title: "Tool output", body: error, language: "text", status: "failed", callId: "c4" }),
    );

    expect(view.toolType).toBe("Glob");
    expect(view.output?.value).toContain("Glob pattern");
    expect(view.status).toBe("failed");
  });
});
