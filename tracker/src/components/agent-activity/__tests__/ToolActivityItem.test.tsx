import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToolActivityItem } from "@/components/agent-activity/ToolActivityItem";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { AgentTaskSnapshot } from "@/types/agentTasks";

const snapshot: AgentTaskSnapshot = {
  source: "plan",
  tasks: [
    { id: "plan-0", text: "Write tests", status: "completed", source: "plan" },
    { id: "plan-1", text: "Implement", status: "in_progress", source: "plan" },
  ],
};

describe("ToolActivityItem", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a task inline card for task tools when a snapshot is present", () => {
    renderWithI18n(
      <ToolActivityItem
        toolName="update_plan"
        view={{
          toolType: "update_plan",
          description: "Plan",
          status: "completed",
          input: { value: "{}", language: "json" },
          output: null,
          defaultCollapsed: true,
        }}
        taskSnapshot={snapshot}
      />,
    );
    expect(screen.getByText("Plan · 1/2 done")).toBeInTheDocument();
  });

  it("renders the standard tool block for non-task tools", () => {
    renderWithI18n(
      <ToolActivityItem
        toolName="read_file"
        view={{
          toolType: "read_file",
          description: "src/app.ts",
          status: "completed",
          input: { value: "src/app.ts", language: "text" },
          output: { value: "ok", language: "text" },
          defaultCollapsed: false,
        }}
        taskSnapshot={snapshot}
      />,
    );
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.queryByText("Plan · 1/2 done")).not.toBeInTheDocument();
  });
});
