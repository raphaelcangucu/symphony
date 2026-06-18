import { describe, expect, it, beforeEach } from "vitest";

import { assistantToolCallToView, isActionTool } from "@/components/assistant/assistantToolCall";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";
import type { AssistantToolCall } from "@/services/assistant";

function toolCall(partial: Partial<AssistantToolCall>): AssistantToolCall {
  return { name: "list_issues", status: "complete", result: {}, ...partial };
}

describe("assistant tool call adapter", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("classifies action vs read tools", () => {
    expect(isActionTool("move_issue")).toBe(true);
    expect(isActionTool("dispatch_codex")).toBe(true);
    expect(isActionTool("create_issue")).toBe(true);
    expect(isActionTool("list_issues")).toBe(false);
    expect(isActionTool("get_issue")).toBe(false);
  });

  it("expands action tools and shows arguments + output", () => {
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
    expect(view.defaultCollapsed).toBe(false);
    expect(view.input?.language).toBe("json");
    expect(view.input?.value).toContain("MAC-1");
    expect(view.output?.value).toBe("Moved issue MAC-1 to In Progress.");
  });

  it("collapses read tools by default", () => {
    const view = assistantToolCallToView(toolCall({ name: "list_issues", status: "complete" }));
    expect(view.defaultCollapsed).toBe(true);
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
});
