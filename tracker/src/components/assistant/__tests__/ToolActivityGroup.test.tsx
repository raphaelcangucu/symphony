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

describe("ToolActivityGroup", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a count label and is collapsed by default for reads", () => {
    renderWithI18n(<ToolActivityGroup group={readGroup()} />);
    expect(screen.getByText("Read 3 files")).toBeInTheDocument();
    expect(screen.queryByText("a.ex")).not.toBeInTheDocument();
  });

  it("expands to show individual rows when clicked", () => {
    renderWithI18n(<ToolActivityGroup group={readGroup()} />);
    fireEvent.click(screen.getByTestId("tool-activity-group"));
    expect(screen.getByText("a.ex")).toBeInTheDocument();
    expect(screen.getByText("c.ex")).toBeInTheDocument();
  });

  it("is expanded by default and shows a failed badge when the group errored", () => {
    const group = readGroup("error");
    group.calls[1] = call({ id: "2", status: "error", arguments: { path: "b.ex" } });
    renderWithI18n(<ToolActivityGroup group={group} />);
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("b.ex")).toBeInTheDocument();
  });
});
