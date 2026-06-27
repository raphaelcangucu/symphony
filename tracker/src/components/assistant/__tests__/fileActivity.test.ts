import { describe, expect, it } from "vitest";

import { fileActivityFromToolCall } from "@/components/assistant/fileActivity";
import type { AssistantToolCall } from "@/services/assistant";

function call(partial: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_workspace_file", status: "complete", result: {}, ...partial };
}

describe("fileActivityFromToolCall", () => {
  it("returns null for non-file tools", () => {
    expect(fileActivityFromToolCall(call({ name: "list_issues" }))).toBeNull();
    expect(fileActivityFromToolCall(call({ name: "update_issue" }))).toBeNull();
  });

  it("maps a read with a line range", () => {
    const view = fileActivityFromToolCall(
      call({
        name: "read_workspace_file",
        arguments: { path: "front/README.md", start_line: 1, end_line: 60 },
        output: "line 1\nline 2",
      }),
    );
    expect(view?.kind).toBe("read");
    expect(view?.path).toBe("front/README.md");
    expect(view?.lineRange).toBe("L1–60");
    expect(view?.body).toEqual({ value: "line 1\nline 2", language: "text" });
  });

  it("formats partial line ranges", () => {
    expect(fileActivityFromToolCall(call({ arguments: { path: "a.ex", start_line: 5 } }))?.lineRange).toBe("L5–");
    expect(fileActivityFromToolCall(call({ arguments: { path: "a.ex", end_line: 9 } }))?.lineRange).toBe("L–9");
    expect(fileActivityFromToolCall(call({ arguments: { path: "a.ex" } }))?.lineRange).toBeNull();
  });

  it("maps an edit with diff counts", () => {
    const view = fileActivityFromToolCall(
      call({
        name: "apply_patch",
        status: "complete",
        result: { diff: "@@\n+a\n+b\n-c", additions: 2, deletions: 1, paths: ["lib/foo.ex"] },
      }),
    );
    expect(view?.kind).toBe("edit");
    expect(view?.title).toBe("lib/foo.ex");
    expect(view?.additions).toBe(2);
    expect(view?.deletions).toBe(1);
    expect(view?.body).toEqual({ value: "@@\n+a\n+b\n-c", language: "diff" });
  });

  it("labels a multi-file edit by count", () => {
    const view = fileActivityFromToolCall(
      call({ name: "apply_patch", result: { paths: ["a.ex", "b.ex"], additions: 3, deletions: 0 } }),
    );
    expect(view?.kind).toBe("edit");
    expect(view?.path).toBeNull();
    expect(view?.title).toBe("2 files");
  });

  it("maps a command with output", () => {
    const view = fileActivityFromToolCall(
      call({ name: "shell", status: "complete", arguments: { command: "mix test" }, output: "1 passed" }),
    );
    expect(view?.kind).toBe("command");
    expect(view?.title).toBe("mix test");
    expect(view?.body).toEqual({ value: "1 passed", language: "bash" });
  });

  it("maps running and error statuses", () => {
    expect(fileActivityFromToolCall(call({ status: "running" }))?.status).toBe("running");
    expect(fileActivityFromToolCall(call({ name: "apply_patch", status: "error" }))?.status).toBe("error");
  });
});
