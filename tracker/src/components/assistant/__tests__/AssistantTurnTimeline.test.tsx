import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantTurnTimeline } from "@/components/assistant/AssistantTurnTimeline";
import type { AssistantContentBlock, AssistantToolCall } from "@/services/assistant";

function toolCall(overrides: Partial<AssistantToolCall>): AssistantToolCall {
  return {
    id: "tool-1",
    name: "read_file",
    status: "complete",
    arguments: {},
    output: null,
    result: {},
    ...overrides,
  };
}

function renderTimeline(contentBlocks: AssistantContentBlock[], toolCalls: AssistantToolCall[]) {
  return render(
    <AssistantTurnTimeline contentBlocks={contentBlocks} toolCalls={toolCalls} />,
  );
}

describe("AssistantTurnTimeline", () => {
  it("renders text, tool activity, then text in DOM order", () => {
    const readCall = toolCall({
      id: "read-1",
      arguments: { path: "timeline-order.ts" },
    });
    const { container } = renderTimeline(
      [
        { type: "text", text: "Before activity" },
        { type: "tool", toolCallId: "read-1" },
        { type: "text", text: "After activity" },
      ],
      [readCall],
    );

    const timelineRows = Array.from(
      container.querySelectorAll(
        '[data-testid="assistant-timeline-text"], [data-testid="assistant-timeline-tool-run"]',
      ),
    );

    expect(timelineRows).toHaveLength(3);
    expect(timelineRows[0]).toHaveAttribute("data-testid", "assistant-timeline-text");
    expect(timelineRows[0]).toHaveTextContent("Before activity");
    expect(timelineRows[1]).toHaveAttribute("data-testid", "assistant-timeline-tool-run");
    expect(timelineRows[1]).toHaveTextContent("timeline-order.ts");
    expect(timelineRows[2]).toHaveAttribute("data-testid", "assistant-timeline-text");
    expect(timelineRows[2]).toHaveTextContent("After activity");
  });

  it("passes adjacent commands together to the existing grouped summary", () => {
    const firstCommand = toolCall({
      id: "command-1",
      name: "shell",
      arguments: { command: "pwd" },
    });
    const secondCommand = toolCall({
      id: "command-2",
      name: "shell",
      arguments: { command: "ls" },
    });

    renderTimeline(
      [
        { type: "tool", toolCallId: "command-1" },
        { type: "tool", toolCallId: "command-2" },
      ],
      [firstCommand, secondCommand],
    );

    expect(screen.getAllByTestId("assistant-timeline-tool-run")).toHaveLength(1);
    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
  });

  it("renders tool-only turns", () => {
    const readCall = toolCall({
      id: "read-only",
      arguments: { path: "tool-only.ts" },
    });

    renderTimeline([{ type: "tool", toolCallId: "read-only" }], [readCall]);

    expect(screen.queryByTestId("assistant-timeline-text")).not.toBeInTheDocument();
    expect(screen.getByTestId("assistant-timeline-tool-run")).toHaveTextContent("tool-only.ts");
  });

  it("uses collision-free keys for distinct tool runs", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const calls = [
      toolCall({ id: "a:b" }),
      toolCall({ id: "c" }),
      toolCall({ id: "a" }),
      toolCall({ id: "b:c" }),
    ];

    try {
      renderTimeline(
        [
          { type: "tool", toolCallId: "a:b" },
          { type: "tool", toolCallId: "c" },
          { type: "text", text: "Between runs" },
          { type: "tool", toolCallId: "a" },
          { type: "tool", toolCallId: "b:c" },
        ],
        calls,
      );

      const errorOutput = consoleError.mock.calls.flat().join(" ");
      expect(errorOutput).not.toContain("same key");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("preserves text and disclosure DOM nodes while a turn streams", () => {
    const pendingCall = toolCall({
      id: "pending-1",
      arguments: { path: "pending.ts" },
    });
    const firstRunCall = toolCall({
      id: "run-1",
      name: "shell",
      arguments: { command: "pwd" },
    });
    const secondRunCall = toolCall({
      id: "run-2",
      name: "shell",
      arguments: { command: "ls" },
    });
    const appendedRunCall = toolCall({
      id: "run-3",
      name: "shell",
      arguments: { command: "git status" },
    });
    const { rerender } = render(
      <AssistantTurnTimeline
        contentBlocks={[
          { type: "tool", toolCallId: "pending-1" },
          { type: "text", text: "Hel" },
          { type: "tool", toolCallId: "run-1" },
          { type: "tool", toolCallId: "run-2" },
        ]}
        toolCalls={[firstRunCall, secondRunCall]}
      />,
    );
    const initialTextNode = screen.getByTestId("assistant-timeline-text");
    const initialRunNode = screen.getByTestId("assistant-timeline-tool-run");
    const initialDisclosureNode = screen.getByTestId("tool-activity-group");

    rerender(
      <AssistantTurnTimeline
        contentBlocks={[
          { type: "tool", toolCallId: "pending-1" },
          { type: "text", text: "Hello" },
          { type: "tool", toolCallId: "run-1" },
          { type: "tool", toolCallId: "run-2" },
          { type: "tool", toolCallId: "run-3" },
        ]}
        toolCalls={[
          pendingCall,
          firstRunCall,
          secondRunCall,
          appendedRunCall,
        ]}
      />,
    );

    expect(screen.getByTestId("assistant-timeline-text")).toBe(initialTextNode);
    expect(screen.getAllByTestId("assistant-timeline-tool-run")[1]).toBe(initialRunNode);
    expect(screen.getByTestId("tool-activity-group")).toBe(initialDisclosureNode);
  });

  it("passes task snapshots into tool activity", () => {
    const planCall = toolCall({
      id: "plan-1",
      name: "update_plan",
      arguments: {
        plan: [{ step: "Ship timeline", status: "completed" }],
      },
    });

    render(
      <AssistantTurnTimeline
        contentBlocks={[{ type: "tool", toolCallId: "plan-1" }]}
        toolCalls={[planCall]}
        taskSnapshot={{
          source: "plan",
          tasks: [
            {
              id: "plan-0",
              text: "Ship timeline",
              status: "completed",
              source: "plan",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Plan · 1/1 done")).toBeInTheDocument();
  });

  it("passes running tool IDs to the kill handler", () => {
    const onKillTool = vi.fn();
    const runningCall = toolCall({
      id: "running-1",
      name: "Bash",
      status: "running",
      arguments: { command: "sleep 30" },
    });

    render(
      <AssistantTurnTimeline
        contentBlocks={[{ type: "tool", toolCallId: "running-1" }]}
        toolCalls={[runningCall]}
        onKillTool={onKillTool}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));

    expect(onKillTool).toHaveBeenCalledOnce();
    expect(onKillTool).toHaveBeenCalledWith("running-1");
  });
});
