import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { AssistantTasksDock } from "@/components/agent-activity/AssistantTasksDock";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  tasks: [
    { id: "1", text: "Verify branches integrated", status: "completed", source: "plan" },
    { id: "2", text: "Remove workspace clones", status: "in_progress", source: "plan" },
  ],
};

describe("AssistantTasksDock", () => {
  it("renders every task and the completion progress", () => {
    render(<AssistantTasksDock snapshot={snapshot} onClose={() => {}} />);

    expect(screen.getByText("Verify branches integrated")).toBeInTheDocument();
    expect(screen.getByText("Remove workspace clones")).toBeInTheDocument();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<AssistantTasksDock snapshot={snapshot} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close tasks panel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
