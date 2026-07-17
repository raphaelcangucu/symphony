import { describe, expect, it } from "vitest";

import {
  adaptSessionLogEntries,
  deriveAgentTasksFromSessionLog,
  messagesFromSessionLogFeed,
  type SessionLogFeedItem,
} from "@/lib/sessionLogFeed";
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

function toolCall(callId: string, title: string, body: string | null = `{"cmd":"${title}"}`): SessionLogEntry {
  return entry({
    kind: "tool_call",
    title,
    body,
    language: "json",
    status: "running",
    callId,
  });
}

function toolResult(
  callId: string,
  body = "ok",
  status: SessionLogEntry["status"] = "completed",
): SessionLogEntry {
  return entry({
    kind: "tool_result",
    title: "Tool output",
    body,
    status,
    callId,
  });
}

function messageItems(items: SessionLogFeedItem[]) {
  return items.filter((item): item is Extract<SessionLogFeedItem, { type: "message" }> => item.type === "message");
}

describe("adaptSessionLogEntries", () => {
  it("maps assistant/user/message entries to chat message bubbles", () => {
    const items = adaptSessionLogEntries([
      entry({ kind: "user", title: "User", body: "hello", language: "markdown" }),
      entry({ kind: "assistant", title: "Codex", body: "**hi**", language: "markdown" }),
      entry({ kind: "message", title: "Note", body: "plain note", language: "text" }),
    ]);

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.type)).toEqual(["message", "message", "message"]);

    const messages = messageItems(items).map((item) => item.message);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "**hi**" });
    expect(messages[2]).toMatchObject({ role: "assistant", content: "plain note" });
    expect(messages.every((message) => message.toolCalls.length === 0)).toBe(true);
  });

  it("maps user entries with <subagent_notification> to subagent_notification items", () => {
    const body = `<subagent_notification>
${JSON.stringify({
  agent_path: "019f7186-95e7-7a91-ac42-e918d56f7b06",
  status: { completed: "DONE\n\nChanged files:\n- `a.ts`" },
})}
</subagent_notification>`;

    const items = adaptSessionLogEntries([
      entry({ kind: "user", title: "You", body, language: "markdown" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("subagent_notification");
    if (items[0].type !== "subagent_notification") throw new Error("expected subagent_notification");
    expect(items[0].notification).toMatchObject({
      agentId: "019f7186-95e7-7a91-ac42-e918d56f7b06",
      headline: "DONE",
      tone: "success",
      detail: "Changed files:\n- `a.ts`",
    });
    expect(messageItems(items)).toHaveLength(0);
  });

  it("pairs tool_call + tool_result by callId into AssistantToolCall statuses", () => {
    const items = adaptSessionLogEntries([
      toolCall("c1", "shell", '{"cmd":"pwd"}'),
      toolResult("c1", "/home", "completed"),
      // Different tool kind so grouping does not merge with the shell call.
      toolCall("c2", "read_file", '{"path":"a.ts"}'),
    ]);

    expect(items).toHaveLength(2);
    const [completedMsg, runningMsg] = messageItems(items).map((item) => item.message);
    const completed = completedMsg.toolCalls[0];
    const running = runningMsg.toolCalls[0];

    expect(completed).toMatchObject({
      id: "c1",
      name: "shell",
      status: "complete",
      arguments: { cmd: "pwd" },
      output: "/home",
    });
    expect(running).toMatchObject({
      id: "c2",
      name: "read_file",
      status: "running",
      arguments: { path: "a.ts" },
      output: null,
    });
  });

  it("maps failed tool results to error status", () => {
    const items = adaptSessionLogEntries([
      toolCall("c1", "shell"),
      toolResult("c1", "boom", "failed"),
    ]);

    expect(messageItems(items)[0].message.toolCalls[0].status).toBe("error");
  });

  it("merges consecutive same-kind tools onto one message so ToolActivityTimeline can group them", () => {
    const items = adaptSessionLogEntries([
      toolCall("c1", "shell"),
      toolResult("c1"),
      toolCall("c2", "exec_command"),
      toolResult("c2"),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("message");
    if (items[0].type !== "message") throw new Error("expected message");
    expect(items[0].message.toolCalls).toHaveLength(2);
    expect(items[0].message.toolCalls.map((call) => call.id)).toEqual(["c1", "c2"]);
  });

  it("groups consecutive event entries into an event_group item", () => {
    const items = adaptSessionLogEntries([
      entry({ kind: "event", title: "turn_started" }),
      entry({ kind: "event", title: "Token Count", body: "in=12 out=34" }),
      entry({ kind: "event", title: "turn_completed" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "event_group" });
    if (items[0].type !== "event_group") throw new Error("expected event_group");
    expect(items[0].entries).toHaveLength(3);
    expect(items[0].entries.map((event) => event.title)).toEqual([
      "turn_started",
      "Token Count",
      "turn_completed",
    ]);
  });

  it("keeps a lone Token Count event visible as a disclosure", () => {
    const items = adaptSessionLogEntries([
      entry({ kind: "event", title: "Token Count", body: "in=1 out=2", collapsed: true }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "disclosure",
      kind: "event",
      title: "Token Count",
      body: "in=1 out=2",
      collapsed: true,
    });
  });

  it("maps reasoning to a collapsible disclosure", () => {
    const items = adaptSessionLogEntries([
      entry({
        kind: "reasoning",
        title: "Thinking",
        body: "step by step",
        collapsed: true,
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "disclosure",
      kind: "reasoning",
      title: "Thinking",
      body: "step by step",
      collapsed: true,
    });
  });

  it("maps system and meta entries to disclosures", () => {
    const items = adaptSessionLogEntries([
      entry({ kind: "system", title: "System notice", body: "ok", language: "text" }),
      entry({ kind: "meta", title: "Session meta", body: '{"k":1}', language: "json", collapsed: true }),
    ]);

    expect(items.map((item) => item.type)).toEqual(["disclosure", "disclosure"]);
    expect(items[0]).toMatchObject({ type: "disclosure", kind: "system", title: "System notice" });
    expect(items[1]).toMatchObject({
      type: "disclosure",
      kind: "meta",
      title: "Session meta",
      language: "json",
      collapsed: true,
    });
  });

  it("preserves entry order and stable keys across mixed kinds", () => {
    const items = adaptSessionLogEntries([
      entry({ kind: "user", title: "User", body: "go" }),
      entry({ kind: "reasoning", title: "Raciocínio interno", body: "..." }),
      entry({ kind: "event", title: "Token Count", body: "n=1" }),
      entry({ kind: "event", title: "turn_started" }),
      toolCall("c1", "shell"),
      toolResult("c1"),
      entry({ kind: "assistant", title: "Codex", body: "done" }),
    ]);

    expect(items.map((item) => item.type)).toEqual([
      "message",
      "disclosure",
      "event_group",
      "message",
      "message",
    ]);

    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toContain("message");
    expect(ids[1]).toContain("disclosure");
    expect(ids[2]).toContain("event-group");

    // Re-running with the same entries yields the same ids (stable keys).
    const again = adaptSessionLogEntries([
      entry({ kind: "user", title: "User", body: "go" }),
      entry({ kind: "reasoning", title: "Raciocínio interno", body: "..." }),
      entry({ kind: "event", title: "Token Count", body: "n=1" }),
      entry({ kind: "event", title: "turn_started" }),
      toolCall("c1", "shell"),
      toolResult("c1"),
      entry({ kind: "assistant", title: "Codex", body: "done" }),
    ]);
    expect(again.map((item) => item.id)).toEqual(ids);
  });

  it("preserves non-JSON tool call bodies so input is not lost", () => {
    const items = adaptSessionLogEntries([
      toolCall("c1", "exec_command", "pwd\nls"),
      toolResult("c1", "/home"),
    ]);

    const call = messageItems(items)[0].message.toolCalls[0];
    expect(call.arguments).toMatchObject({ cmd: "pwd\nls" });
    expect(call.output).toBe("/home");
  });
});

describe("deriveAgentTasksFromSessionLog", () => {
  it("derives tasks from raw session-log entries (not the adapted feed)", () => {
    const entries = [
      toolCall("c1", "update_plan", JSON.stringify({ plan: [{ step: "Ship", status: "pending" }] })),
      toolResult("c1", "ok"),
    ];

    const fromRaw = deriveAgentTasksFromSessionLog(entries);
    expect(fromRaw?.tasks).toHaveLength(1);
    expect(fromRaw?.tasks[0]).toMatchObject({ text: "Ship", status: "pending" });

    // Adapted feed still exposes toolCalls so assistant-style derivation works too.
    const feed = adaptSessionLogEntries(entries);
    const fromMessages = deriveAgentTasksFromSessionLog(entries);
    expect(fromMessages).toEqual(fromRaw);
    expect(messagesFromSessionLogFeed(feed)[0].toolCalls[0].name).toBe("update_plan");
  });
});
