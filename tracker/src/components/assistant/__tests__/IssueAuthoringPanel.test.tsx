import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { IssueAuthoringPanel } from "@/components/assistant/IssueAuthoringPanel";

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

vi.mock("@/components/assistant/AssistantKbDocumentsPanel", () => ({
  AssistantKbDocumentsPanel: ({
    projectSlug,
    issueIdentifier,
    citedPaths,
  }: {
    projectSlug: string;
    issueIdentifier?: string;
    citedPaths: string[];
  }) => (
    <section aria-label="Knowledge base documents">
      KB {projectSlug}:{issueIdentifier ?? "none"}:{citedPaths.join(",") || "none"}
    </section>
  ),
}));

vi.mock("@/components/issues/IssueEditorMenu", () => ({
  IssueEditorMenu: ({ projectSlug, identifier }: { projectSlug: string; identifier: string }) => (
    <button type="button" aria-label="Open in code">
      Editor {projectSlug}:{identifier}
    </button>
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
      "flex-1",
      "overflow-hidden",
    );
    expect(screen.queryByRole("button", { name: /documents/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: /knowledge base documents/i })).toHaveTextContent(
      "KB macro-markets:MAC-1:none",
    );
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

  it("shows the issue editor menu next to the issue detail link", () => {
    render(
      <MemoryRouter>
        <IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /open in code/i })).toHaveTextContent(
      "Editor macro-markets:MAC-1",
    );
    expect(screen.getByRole("link", { name: /open issue details/i })).toBeInTheDocument();
  });

  it("shows the new-issue intro and empty documents state until an identifier exists", () => {
    render(
      <MemoryRouter>
        <IssueAuthoringPanel projectSlug="macro-markets" view="board" />
      </MemoryRouter>,
    );

    expect(screen.getByText("New issue authoring")).toBeTruthy();
    expect(screen.getByText(/Start by asking the assistant to draft an issue/i)).toBeTruthy();
    expect(screen.getByRole("region", { name: /knowledge base documents/i })).toHaveTextContent(
      "KB macro-markets:none:none",
    );
  });
});
