import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubagentDrawerContext } from "@/components/agent-activity/subagentDrawerContext";
import { SubagentToolCard } from "@/components/agent-activity/typed-tools/SubagentToolCard";
import type { SubagentRef } from "@/lib/subagentRef";
import type { ToolPresentation } from "@/lib/toolCallPresentation";

const REF: SubagentRef = {
  resolve: "id",
  id: "a0b70422f9f999605",
  nickname: "explorer",
  subagentType: "Explore",
  taskPreview: "Extract signatures",
};

const PRESENTATION: ToolPresentation = {
  family: "spawn_agent",
  toolName: "spawn_agent",
  title: "explorer",
  summary: "Extract signatures",
  status: "completed",
  badges: [],
  links: [],
  body: null,
  raw: null,
  meta: {},
  subagentRef: REF,
};

describe("SubagentToolCard", () => {
  it("renders nickname and role badge", () => {
    render(<SubagentToolCard presentation={PRESENTATION} subagentRef={REF} />);

    expect(screen.getByText("explorer")).toBeTruthy();
    expect(screen.getByText("Explore")).toBeTruthy();
    expect(screen.getByText(/subagent/i)).toBeTruthy();
  });

  it("hides the view-activity button without a drawer provider", () => {
    render(<SubagentToolCard presentation={PRESENTATION} subagentRef={REF} />);
    expect(screen.queryByTestId("subagent-view-activity")).toBeNull();
  });

  it("calls openSubagent with the ref when the button is clicked", () => {
    const openSubagent = vi.fn();
    render(
      <SubagentDrawerContext.Provider value={{ openSubagent, agentKind: "codex" }}>
        <SubagentToolCard presentation={PRESENTATION} subagentRef={REF} />
      </SubagentDrawerContext.Provider>,
    );

    fireEvent.click(screen.getByTestId("subagent-view-activity"));
    expect(openSubagent).toHaveBeenCalledTimes(1);
    expect(openSubagent).toHaveBeenCalledWith(REF);
  });
});
