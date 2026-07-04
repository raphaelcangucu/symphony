import { describe, expect, it } from "vitest";

import {
  groupSessionLogItems,
  pairSessionLogItems,
  sessionPairToView,
} from "@/components/issues/issue-detail/sessionToolCall";
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

function toolCall(callId: string, title: string): SessionLogEntry {
  return entry({ kind: "tool_call", title, body: `{"cmd":"${title}"}`, language: "bash", status: "completed", callId });
}

function toolResult(callId: string, status: SessionLogEntry["status"] = "completed"): SessionLogEntry {
  return entry({ kind: "tool_result", title: "output", body: "ok", status, callId });
}

describe("groupSessionLogItems", () => {
  it("groups consecutive same-kind tool calls into a single collapsible group", () => {
    const items = groupSessionLogItems([
      toolCall("c1", "shell"),
      toolResult("c1"),
      toolCall("c2", "exec_command"),
      toolResult("c2"),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "toolGroup", kind: "command", status: "complete" });
    if (items[0].type !== "toolGroup") throw new Error("expected toolGroup");
    expect(items[0].pairs).toHaveLength(2);
  });

  it("keeps a single tool call standalone (no group)", () => {
    const items = groupSessionLogItems([toolCall("c1", "shell"), toolResult("c1")]);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("toolCall");
  });

  it("splits groups when the tool kind changes", () => {
    const items = groupSessionLogItems([
      toolCall("c1", "shell"),
      toolResult("c1"),
      toolCall("c2", "read_file"),
      toolResult("c2"),
      toolCall("c3", "read_file"),
      toolResult("c3"),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("toolCall");
    expect(items[1]).toMatchObject({ type: "toolGroup", kind: "read" });
  });

  it("breaks a group when a message entry interrupts the run", () => {
    const items = groupSessionLogItems([
      toolCall("c1", "shell"),
      toolResult("c1"),
      entry({ kind: "assistant", title: "assistant", body: "thinking" }),
      toolCall("c2", "exec_command"),
      toolResult("c2"),
    ]);

    expect(items).toHaveLength(3);
    expect(items[0].type).toBe("toolCall");
    expect(items[1].type).toBe("entry");
    expect(items[2].type).toBe("toolCall");
  });

  it("marks the group as error when any tool in the run failed", () => {
    const items = groupSessionLogItems([
      toolCall("c1", "shell"),
      toolResult("c1"),
      toolCall("c2", "exec_command"),
      toolResult("c2", "failed"),
    ]);

    if (items[0].type !== "toolGroup") throw new Error("expected toolGroup");
    expect(items[0].status).toBe("error");
  });

  it("groups consecutive event entries into a single event group", () => {
    const items = groupSessionLogItems([
      entry({ kind: "event", title: "turn_started" }),
      entry({ kind: "event", title: "agent run failed", body: "{:turn_failed, ...}" }),
      entry({ kind: "event", title: "turn_aborted" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "eventGroup" });
    if (items[0].type !== "eventGroup") throw new Error("expected eventGroup");
    expect(items[0].entries).toHaveLength(3);
  });

  it("keeps a lone event standalone (no group)", () => {
    const items = groupSessionLogItems([entry({ kind: "event", title: "agent run failed" })]);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("entry");
  });

  it("does not merge events with tools or messages", () => {
    const items = groupSessionLogItems([
      entry({ kind: "event", title: "turn_started" }),
      entry({ kind: "event", title: "note" }),
      entry({ kind: "assistant", title: "Codex", body: "hi" }),
      entry({ kind: "event", title: "turn_completed" }),
      toolCall("c1", "shell"),
      toolResult("c1"),
    ]);

    expect(items.map((item) => item.type)).toEqual(["eventGroup", "entry", "entry", "toolCall"]);
  });
});
