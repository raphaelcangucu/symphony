import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AgentTaskInlineCard } from "@/components/agent-activity/AgentTaskInlineCard";
import { renderWithI18n } from "@/i18n/testUtils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  tasks: [
    { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
    { id: "plan-1", text: "Implement", status: "in_progress", source: "plan" },
  ],
};

describe("AgentTaskInlineCard", () => {
  it("shows a one-line summary with the source label and progress", () => {
    renderWithI18n(<AgentTaskInlineCard snapshot={snapshot} />);
    expect(screen.getByText("Plan · 1/2 done")).toBeInTheDocument();
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Plan/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /Plan/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("expands to reveal the task list with existing statuses", async () => {
    const user = userEvent.setup();
    renderWithI18n(<AgentTaskInlineCard snapshot={snapshot} />);
    await user.click(screen.getByRole("button", { name: /Plan/ }));

    expect(screen.getByText("Write tests").closest("li")).toHaveAttribute(
      "data-status",
      "completed",
    );
    expect(screen.getByText("Write tests")).toHaveClass("line-through");
    expect(screen.getByText("Implement").closest("li")).toHaveAttribute(
      "data-status",
      "in_progress",
    );
  });
});
