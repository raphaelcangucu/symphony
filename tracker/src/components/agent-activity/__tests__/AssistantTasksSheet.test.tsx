import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { AssistantTasksSheet } from "@/components/agent-activity/AssistantTasksSheet";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  tasks: [
    { id: "1", text: "Verify branches integrated", status: "completed", source: "plan" },
    { id: "2", text: "Remove workspace clones", status: "in_progress", source: "plan" },
  ],
};

describe("AssistantTasksSheet", () => {
  it("renders tasks when open", () => {
    render(<AssistantTasksSheet open snapshot={snapshot} onOpenChange={() => {}} />);

    expect(screen.getByTestId("assistant-tasks-sheet")).toBeInTheDocument();
    expect(screen.getByText("Verify branches integrated")).toBeInTheDocument();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
  });

  it("notifies onOpenChange when dismissed", () => {
    const onOpenChange = vi.fn();
    render(<AssistantTasksSheet open snapshot={snapshot} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("rejects an empty snapshot", () => {
    expect(() =>
      render(
        <AssistantTasksSheet
          open
          snapshot={{ source: "plan", tasks: [] }}
          onOpenChange={() => {}}
        />,
      ),
    ).toThrow(/non-empty task snapshot/i);
  });
});
