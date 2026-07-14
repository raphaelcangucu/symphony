import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToolActivityGroup } from "@/components/assistant/ToolActivityGroup";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { ToolCallGroup } from "@/lib/toolCallGroups";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: { path: "a.ex" }, output: "x", result: {}, ...overrides };
}

function readGroup(status: ToolCallGroup["status"] = "complete"): ToolCallGroup {
  return {
    kind: "read",
    status,
    calls: [
      call({ id: "1", arguments: { path: "a.ex" } }),
      call({ id: "2", arguments: { path: "b.ex" } }),
      call({ id: "3", arguments: { path: "c.ex" } }),
    ],
  };
}

function actionGroup(status: ToolCallGroup["status"] = "complete"): ToolCallGroup {
  return {
    kind: "action",
    status,
    calls: [
      call({
        id: "action-1",
        name: "move_issue",
        status,
        arguments: { identifier: "SYM-1" },
        output: "Moved SYM-1",
      }),
      call({
        id: "action-2",
        name: "move_issue",
        status: "complete",
        arguments: { identifier: "SYM-2" },
        output: "Moved SYM-2",
      }),
    ],
  };
}

describe("ToolActivityGroup", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it.each([
    ["reads", readGroup()],
    ["actions", actionGroup()],
    ["errors", actionGroup("error")],
    ["running work", actionGroup("running")],
  ])("keeps %s closed initially", (_label, group) => {
    renderWithI18n(<ToolActivityGroup group={group} />);

    const summary = screen.getByTestId("tool-activity-group");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(group.kind === "read" ? "a.ex" : "IN")).not.toBeInTheDocument();
  });

  it("expands to show individual rows when clicked", () => {
    renderWithI18n(<ToolActivityGroup group={readGroup()} />);
    fireEvent.click(screen.getByTestId("tool-activity-group"));
    expect(screen.getByText("a.ex")).toBeInTheDocument();
    expect(screen.getByText("c.ex")).toBeInTheDocument();
    expect(screen.getByTestId("tool-activity-group").parentElement).not.toHaveClass(
      "rounded-xl",
      "border",
    );
    expect(screen.getByText("a.ex").closest("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows failed status without opening errored details", () => {
    const group = readGroup("error");
    group.calls[1] = call({ id: "2", status: "error", arguments: { path: "b.ex" } });
    renderWithI18n(<ToolActivityGroup group={group} />);

    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.queryByText("b.ex")).not.toBeInTheDocument();
  });

  it("shows running status without dumping output", () => {
    const group = readGroup("running");
    group.calls[0] = call({
      id: "1",
      status: "running",
      arguments: { path: "running.ex" },
      output: "partial output",
    });
    renderWithI18n(<ToolActivityGroup group={group} />);

    const summary = screen.getByTestId("tool-activity-group");
    expect(summary).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByText("partial output")).not.toBeInTheDocument();
  });
});
