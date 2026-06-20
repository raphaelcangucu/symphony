import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";

vi.mock("@/hooks/useIssueDocuments", () => ({
  useIssueDocuments: () => ({
    available: true,
    documents: [],
    loading: false,
    reason: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: ({
    issueIdentifier,
    mode,
    projectSlug,
    view,
  }: {
    issueIdentifier?: string;
    mode?: "sheet" | "page" | "embedded";
    projectSlug?: string;
    view: "board" | "list";
  }) => (
    <div data-testid="project-assistant-panel">
      Assistant {projectSlug}:{issueIdentifier ?? "none"}:{view}:{mode}
    </div>
  ),
}));

vi.mock("@/components/assistant/DocumentViewer", () => ({
  DocumentViewer: ({ identifier, projectSlug }: { identifier: string; projectSlug: string }) => (
    <section aria-label="Issue documents">
      Documents {projectSlug}:{identifier}
    </section>
  ),
}));

describe("IssueAuthoringPanel", () => {
  it("uses embedded drawer layout when compact", () => {
    render(
      <MemoryRouter>
        <IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="list" compact />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent(
      "Assistant macro-markets:MAC-1:list:embedded",
    );
    expect(screen.getByRole("region", { name: /issue authoring chat/i })).toHaveClass(
      "flex",
      "min-h-0",
      "overflow-hidden",
    );
  });

  it("uses the full-page layout when not compact", () => {
    render(
      <MemoryRouter>
        <IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent(
      "Assistant macro-markets:MAC-1:board:page",
    );
    expect(screen.getByRole("region", { name: /issue documents/i })).toBeInTheDocument();
  });

  it("omits the visual mode, goal, and dispatch controls inside an existing issue", () => {
    render(
      <MemoryRouter>
        <IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Simple" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complex" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /goal mode/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /dispatch to/i })).toBeNull();
    expect(screen.queryByText(/Issue authoring: MAC-1/i)).toBeNull();
    expect(screen.queryByText("New issue authoring")).toBeNull();
  });

  it("does not render orchestrator execution status (that lives on the Execution tab)", () => {
    render(
      <MemoryRouter>
        <IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />
      </MemoryRouter>,
    );

    // The Authoring tab is scoped to the assistant conversation; execution badges/goals belong
    // to the Execution tab, so none of them should appear here.
    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.queryByRole("status", { name: "Active goal" })).toBeNull();
    expect(screen.getByTestId("project-assistant-panel")).toBeInTheDocument();
  });

  it("shows the new-issue intro and empty documents state until an identifier exists", () => {
    render(
      <MemoryRouter>
        <IssueAuthoringPanel projectSlug="macro-markets" view="board" />
      </MemoryRouter>,
    );

    expect(screen.getByText("New issue authoring")).toBeTruthy();
    expect(screen.getByText(/Start by asking the assistant to draft an issue/i)).toBeTruthy();
    expect(screen.getByText(/Draft documents appear here/i)).toBeTruthy();
    expect(screen.queryByRole("region", { name: /issue documents/i })).toBeNull();
  });
});
