import { describe, expect, it, beforeEach } from "vitest";

import { assistantToolCallToView, isActionTool } from "@/components/assistant/assistantToolCall";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";
import type { AssistantToolCall } from "@/services/assistant";

function toolCall(partial: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "list_issues", status: "complete", result: {}, ...partial };
}

describe("assistant tool call adapter", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("classifies action vs read tools", () => {
    expect(isActionTool("move_issue")).toBe(true);
    expect(isActionTool("dispatch_codex")).toBe(true);
    expect(isActionTool("create_issue")).toBe(true);
    expect(isActionTool("delete_comment")).toBe(true);
    expect(isActionTool("list_issues")).toBe(false);
    expect(isActionTool("get_issue")).toBe(false);
  });

  it("keeps action tools closed while preserving arguments and output", () => {
    const view = assistantToolCallToView(
      toolCall({
        name: "move_issue",
        status: "complete",
        arguments: { identifier: "MAC-1", status: "In Progress" },
        output: "Moved issue MAC-1 to In Progress.",
      }),
    );

    expect(view.toolType).toBe(i18n.t("issue.toolCall.tools.move_issue"));
    expect(view.status).toBe("completed");
    expect(view.defaultCollapsed).toBe(true);
    expect(view.input?.language).toBe("json");
    expect(view.input?.value).toContain("MAC-1");
    expect(view.output?.value).toBe("Moved issue MAC-1 to In Progress.");
  });

  it("collapses read tools by default", () => {
    const view = assistantToolCallToView(toolCall({ name: "list_issues", status: "complete" }));
    expect(view.defaultCollapsed).toBe(true);
  });

  it("keeps running Bash details closed by default", () => {
    const view = assistantToolCallToView(
      toolCall({
        id: "t1",
        name: "Bash",
        status: "running",
        arguments: { command: "pest --parallel" },
      }),
    );
    expect(view.defaultCollapsed).toBe(true);
    expect(view.input?.language).toBe("bash");
  });

  it("maps error status to failed", () => {
    const view = assistantToolCallToView(toolCall({ name: "move_issue", status: "error", output: "Issue not found." }));
    expect(view.status).toBe("failed");
    expect(view.output?.value).toBe("Issue not found.");
  });

  it("localizes tool names in pt-BR", async () => {
    await initTestI18n("pt-BR");
    const view = assistantToolCallToView(toolCall({ name: "move_issue", status: "complete" }));
    expect(view.toolType).toBe("Mover issue");
  });

  it("memoizes the view per tool-call identity to avoid reprocessing output each render", () => {
    const call = toolCall({ id: "t1", name: "shell", status: "complete", output: "1 passed" });

    const first = assistantToolCallToView(call);
    const second = assistantToolCallToView(call);

    expect(second).toBe(first);
  });

  it("recomputes when the tool call is replaced by a new object (status/output change)", () => {
    const running = toolCall({ id: "t1", name: "shell", status: "running" });
    const complete = toolCall({ id: "t1", name: "shell", status: "complete", output: "done" });

    const runningView = assistantToolCallToView(running);
    const completeView = assistantToolCallToView(complete);

    expect(completeView).not.toBe(runningView);
    expect(completeView.status).toBe("completed");
    expect(completeView.output?.value).toBe("done");
  });

  it("propagates server truncation flags so the block can offer a full-output fetch", () => {
    const truncated = assistantToolCallToView(
      toolCall({ id: "t2", name: "shell", status: "complete", output: "preview…", outputTruncated: true, outputByteSize: 1048576 }),
    );
    expect(truncated.outputTruncated).toBe(true);
    expect(truncated.outputByteSize).toBe(1048576);

    const untruncated = assistantToolCallToView(toolCall({ id: "t3", name: "shell", status: "complete", output: "done" }));
    expect(untruncated.outputTruncated).toBe(false);
    expect(untruncated.outputByteSize).toBeNull();
  });
});
