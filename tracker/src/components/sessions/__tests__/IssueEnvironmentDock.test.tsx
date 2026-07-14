import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueEnvironmentDock } from "@/components/sessions/IssueEnvironmentDock";
import { initTestI18n } from "@/i18n/testUtils";

vi.mock("@/hooks/useWorkspaceDiffStats", () => ({
  useWorkspaceDiffStats: () => ({ additions: 12, deletions: 4 }),
}));

vi.mock("@/hooks/useHorizontalPanelResize", () => ({
  useHorizontalPanelResize: () => ({
    width: 280,
    isResizing: false,
    onResizePointerDown: vi.fn(),
    onResizePointerUp: vi.fn(),
  }),
}));

vi.mock("@/components/issues/issue-detail/git-diff/GitDiffLauncher", () => ({
  GitDiffLauncher: ({ openRequestId }: { openRequestId?: number }) => (
    <div data-testid="git-diff-launcher" data-open-request-id={openRequestId ?? 0} />
  ),
}));

describe("IssueEnvironmentDock", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders changes, sources, and closes from the header", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const containerRef = createRef<HTMLDivElement>();

    render(
      <MemoryRouter>
        <div ref={containerRef}>
          <IssueEnvironmentDock
            projectSlug="macro-markets"
            issueIdentifier="510"
            view="board"
            branch="feature/env-dock"
            splitContainerRef={containerRef}
            onClose={onClose}
          />
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("environment-dock")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−4")).toBeInTheDocument();
    expect(screen.getByText("feature/env-dock")).toBeInTheDocument();
    expect(screen.getByText("macro-markets")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close environment/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("bumps compare request id when Compare is clicked", async () => {
    const user = userEvent.setup();
    const containerRef = createRef<HTMLDivElement>();

    render(
      <MemoryRouter>
        <div ref={containerRef}>
          <IssueEnvironmentDock
            projectSlug="macro-markets"
            issueIdentifier="510"
            view="board"
            splitContainerRef={containerRef}
            onClose={vi.fn()}
          />
        </div>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("git-diff-launcher")).toHaveAttribute("data-open-request-id", "0");
    await user.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.getByTestId("git-diff-launcher")).toHaveAttribute("data-open-request-id", "1");
  });
});
