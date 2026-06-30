import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AgentTaskList } from "@/components/issues/issue-detail/AgentTaskList";
import { renderWithI18n } from "@/i18n/testUtils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  explanation: "Working through the plan",
  tasks: [
    { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
    { id: "plan-1", text: "Implement", status: "in_progress", source: "plan" },
    { id: "plan-2", text: "Docs", status: "pending", source: "plan" },
  ],
};

describe("AgentTaskList", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the tasks with a progress count and explanation", () => {
    renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("1/3 done")).toBeInTheDocument();
    expect(screen.getByText("Working through the plan")).toBeInTheDocument();
  });

  it("marks completed tasks with a completed status", () => {
    renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    const completed = screen.getByText("Write tests").closest("li");
    expect(completed).toHaveAttribute("data-status", "completed");
  });

  it("collapses and expands the list, persisting the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    await user.click(screen.getByRole("button", { name: "Collapse tasks" }));
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
    unmount();
    renderWithI18n(<AgentTaskList snapshot={snapshot} />);
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand tasks" })).toBeInTheDocument();
  });
});
