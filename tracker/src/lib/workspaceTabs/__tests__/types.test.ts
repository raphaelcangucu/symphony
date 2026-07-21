import { describe, expect, it } from "vitest";

import {
  createThreadTerminalTab,
  threadTerminalTabId,
} from "@/lib/workspaceTabs/types";

describe("thread terminal workspace tabs", () => {
  it("builds a stable non-closable tab for a positive thread id", () => {
    expect(threadTerminalTabId(8076)).toBe("thread-terminal:8076");
    expect(createThreadTerminalTab(8076, "Workspace shell")).toEqual({
      id: "thread-terminal:8076",
      kind: "thread-terminal",
      title: "Workspace shell",
      closable: false,
      threadId: 8076,
    });
  });

  it("rejects invalid thread ids", () => {
    expect(() => threadTerminalTabId(0)).toThrow("threadId must be a positive integer");
    expect(() => createThreadTerminalTab(1.5, "Shell")).toThrow(
      "threadId must be a positive integer",
    );
  });
});
