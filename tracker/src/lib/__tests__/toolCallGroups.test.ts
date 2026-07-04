import { describe, expect, it } from "vitest";

import { classifyToolCall, groupStatus, groupToolCalls, summarizeGroup } from "@/lib/toolCallGroups";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: null, output: null, result: {}, ...overrides };
}

describe("classifyToolCall", () => {
  it("maps tool names to kinds", () => {
    expect(classifyToolCall(call({ name: "read_file" }))).toBe("read");
    expect(classifyToolCall(call({ name: "apply_patch" }))).toBe("edit");
    expect(classifyToolCall(call({ name: "shell" }))).toBe("command");
    expect(classifyToolCall(call({ name: "create_issue" }))).toBe("action");
    expect(classifyToolCall(call({ name: "list_issues" }))).toBe("query");
    expect(classifyToolCall(call({ name: "get_project" }))).toBe("query");
    expect(classifyToolCall(call({ name: "mystery_tool" }))).toBe("other");
  });
});

describe("groupToolCalls", () => {
  it("groups consecutive same-kind calls", () => {
    const groups = groupToolCalls([
      call({ id: "1", name: "read_file" }),
      call({ id: "2", name: "read_workspace_file" }),
      call({ id: "3", name: "shell" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: "read" });
    expect(groups[0].calls).toHaveLength(2);
    expect(groups[1]).toMatchObject({ kind: "command" });
  });

  it("splits a group when a different kind interrupts the run", () => {
    const groups = groupToolCalls([
      call({ id: "1", name: "read_file" }),
      call({ id: "2", name: "shell" }),
      call({ id: "3", name: "read_file" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["read", "command", "read"]);
  });
});

describe("groupStatus", () => {
  it("running beats error beats complete", () => {
    expect(groupStatus([call({ status: "running" }), call({ status: "error" })])).toBe("running");
    expect(groupStatus([call({ status: "error" }), call({ status: "complete" })])).toBe("error");
    expect(groupStatus([call({ status: "complete" })])).toBe("complete");
  });
});

describe("summarizeGroup", () => {
  it("counts calls and sums diff stats", () => {
    const summary = summarizeGroup({
      kind: "edit",
      status: "complete",
      calls: [
        call({ name: "apply_patch", result: { additions: 10, deletions: 2 } }),
        call({ name: "apply_patch", result: { additions: 5, deletions: 1 } }),
      ],
    });
    expect(summary).toEqual({ count: 2, additions: 15, deletions: 3 });
  });
});
