import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolActivityTimeline } from "@/components/agent-activity/ToolActivityTimeline";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";
import type { AssistantToolCall } from "@/services/assistant";

function call(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return { id: null, name: "read_file", status: "complete", arguments: { path: "a.ex" }, output: "x", result: {}, ...overrides };
}

describe("ToolActivityTimeline (agent-activity)", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a single tool call collapsed by default with a chevron toggle", () => {
    renderWithI18n(
      <ToolActivityTimeline toolCalls={[call({ id: "1", arguments: { path: "only.ex" } })]} />,
    );

    const summary = screen.getByRole("button", { name: /only\.ex/i });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("x")).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("renders a grouped run collapsed by default, and keeps rows collapsed once the group opens", () => {
    renderWithI18n(
      <ToolActivityTimeline
        toolCalls={[
          call({ id: "1", arguments: { path: "a.ex" } }),
          call({ id: "2", arguments: { path: "b.ex" } }),
          call({ id: "3", arguments: { path: "c.ex" } }),
        ]}
      />,
    );

    const groupSummary = screen.getByTestId("tool-activity-group");
    expect(groupSummary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("a.ex")).not.toBeInTheDocument();

    fireEvent.click(groupSummary);
    expect(groupSummary).toHaveAttribute("aria-expanded", "true");

    const rowSummary = screen.getByText("a.ex").closest("button");
    expect(rowSummary).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(rowSummary as HTMLElement);
    expect(rowSummary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("still surfaces the kill-tool action for running calls once expanded", () => {
    const onKillTool = vi.fn();
    renderWithI18n(
      <ToolActivityTimeline
        toolCalls={[
          call({
            id: "running-1",
            name: "custom_tool",
            status: "running",
            arguments: { target: "running-target" },
          }),
        ]}
        onKillTool={onKillTool}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /custom tool/i }));
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    expect(onKillTool).toHaveBeenCalledWith("running-1");
  });

  it("still renders a task inline marker instead of a raw tool block", () => {
    const taskSnapshot: AgentTaskSnapshot = {
      source: "plan",
      tasks: [
        { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
        { id: "plan-1", text: "Ship", status: "pending", source: "plan" },
      ],
    };

    renderWithI18n(
      <ToolActivityTimeline
        taskSnapshot={taskSnapshot}
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
