import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToolActivityTimeline } from "@/components/assistant/ToolActivityTimeline";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: { path: "a.ex" }, output: "x", result: {}, ...overrides };
}

describe("ToolActivityTimeline", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a single call without a group header", () => {
    renderWithI18n(<ToolActivityTimeline toolCalls={[call({ id: "1", arguments: { path: "only.ex" } })]} />);
    expect(screen.queryByTestId("tool-activity-group")).not.toBeInTheDocument();
    expect(screen.getByText("only.ex")).toBeInTheDocument();
  });

  it("groups 3 consecutive reads into one group header", () => {
    renderWithI18n(
      <ToolActivityTimeline
        toolCalls={[
          call({ id: "1", arguments: { path: "a.ex" } }),
          call({ id: "2", arguments: { path: "b.ex" } }),
          call({ id: "3", arguments: { path: "c.ex" } }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("tool-activity-group")).toHaveLength(1);
    expect(screen.getByText("Read 3 files")).toBeInTheDocument();
  });

  it("renders separate groups when kinds alternate", () => {
    renderWithI18n(
      <ToolActivityTimeline
        toolCalls={[
          call({ id: "1", name: "read_file", arguments: { path: "a.ex" } }),
          call({ id: "2", name: "read_file", arguments: { path: "b.ex" } }),
          call({ id: "3", name: "shell", arguments: { command: "ls" } }),
          call({ id: "4", name: "shell", arguments: { command: "pwd" } }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("tool-activity-group")).toHaveLength(2);
    expect(screen.getByText("Read 2 files")).toBeInTheDocument();
    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
  });

  it("renders a task inline marker instead of a raw tool block", () => {
    renderWithI18n(
      <ToolActivityTimeline
        taskSnapshot={{
          source: "plan",
          tasks: [
            { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
            { id: "plan-1", text: "Ship", status: "pending", source: "plan" },
          ],
        }}
        toolCalls={[
          call({
            id: "plan-1",
            name: "update_plan",
            arguments: {
              plan: [
                { step: "Write tests", status: "completed" },
                { step: "Ship", status: "pending" },
              ],
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Plan · 1/2 done")).toBeInTheDocument();
  });
});
