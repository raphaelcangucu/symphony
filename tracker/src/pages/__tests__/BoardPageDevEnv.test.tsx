import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { BoardPage } from "@/pages/BoardPage";

vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({
    projectSlug: "macro-markets",
    view: "board",
    board: {},
    statusNames: [],
    workflowStatuses: [],
    loading: false,
    issues: [],
    trackerKind: "local",
    agentExecutions: new Map(),
    collapsed: new Set(),
    toggleCollapse: vi.fn(),
    moveIssueOptimistically: vi.fn(),
    setIssues: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/board/BoardView", () => ({
  BoardView: () => <div>Board view</div>,
}));

vi.mock("@/hooks/useTrackerPolling", () => ({
  useTrackerPolling: () => undefined,
}));

describe("BoardPage dev environment setup entry", () => {
  it("does not render the dev environment setup action on the board", () => {
    render(
      <MemoryRouter>
        <BoardPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /Dev environment setup/i })).toBeNull();
    expect(screen.getByText("Board view")).toBeTruthy();
  });
});
