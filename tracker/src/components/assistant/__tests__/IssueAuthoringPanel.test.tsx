import { fireEvent, render, screen } from "@testing-library/react";
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
    issueMode,
    issueGoalMode,
    dispatchRequestId,
    mode,
    onIssueModeChanged,
    onIssueGoalModeChanged,
    onDispatchSucceeded,
    onDispatchError,
    projectSlug,
    view,
  }: {
    issueIdentifier?: string;
    issueMode?: "triage" | "simple" | "complex";
    issueGoalMode?: boolean;
    dispatchRequestId?: number;
    mode?: "sheet" | "page" | "embedded";
    onIssueModeChanged?: (mode: "triage" | "simple" | "complex") => void;
    onIssueGoalModeChanged?: (enabled: boolean) => void;
    onDispatchSucceeded?: (message: string) => void;
    onDispatchError?: (message: string) => void;
    projectSlug?: string;
    view: "board" | "list";
  }) => (
    <div data-testid="project-assistant-panel">
      Assistant {projectSlug}:{issueIdentifier}:{view}:{mode}:{issueMode ?? "unset"}:goal=
      {issueGoalMode === undefined ? "unset" : String(issueGoalMode)}:dispatch=
      {dispatchRequestId ?? 0}
      <button type="button" onClick={() => onIssueModeChanged?.(issueMode ?? "triage")}>
        acknowledge mode
      </button>
      <button type="button" onClick={() => onIssueModeChanged?.("complex")}>
        hydrate complex
      </button>
      <button type="button" onClick={() => onIssueGoalModeChanged?.(issueGoalMode ?? false)}>
        acknowledge goal
      </button>
      <button type="button" onClick={() => onIssueGoalModeChanged?.(true)}>
        hydrate goal
      </button>
      <button type="button" onClick={() => onDispatchSucceeded?.("Requested Codex work on MAC-1")}>
        confirm dispatch
      </button>
      <button type="button" onClick={() => onDispatchError?.("dispatch failed")}>
        fail dispatch
      </button>
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
    render(<IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="list" compact />);

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent(
      "Assistant macro-markets:MAC-1:list:embedded:triage",
    );
    expect(screen.getByRole("region", { name: /issue authoring chat/i })).toHaveClass(
      "flex",
      "min-h-0",
      "overflow-hidden",
    );
    expect(screen.getByTestId("project-assistant-panel").parentElement).toHaveClass(
      "h-full",
      "min-h-0",
      "flex-1",
      "overflow-hidden",
    );

    const documentsSection = screen.getByRole("complementary", { name: /issue authoring documents/i });
    const documentViewer = screen.getByRole("region", { name: /issue documents/i });
    expect(documentsSection).toHaveClass("flex", "min-h-0", "flex-1", "overflow-hidden");
    expect(documentViewer.parentElement).not.toBe(documentsSection);
    expect(documentViewer.parentElement).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
  });

  it("renders simple and complex mode controls for issue authoring", () => {
    render(<IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />);

    expect(screen.getByRole("button", { name: "Simple" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Complex" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/mode controls can be added/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Complex" }));

    expect(screen.getByRole("button", { name: "Complex" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent(
      "Assistant macro-markets:MAC-1:board:page:complex",
    );

    fireEvent.click(screen.getByRole("button", { name: "acknowledge mode" }));

    expect(screen.getByText("Complex mode active.")).toBeTruthy();
  });

  it("exposes a Codex goal-mode toggle and confirms it when acknowledged", () => {
    render(<IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />);

    const goalToggle = screen.getByRole("checkbox", { name: /codex goal mode/i });
    expect(goalToggle).not.toBeChecked();
    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent("goal=false");

    fireEvent.click(goalToggle);

    expect(goalToggle).toBeChecked();
    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent("goal=true");

    fireEvent.click(screen.getByRole("button", { name: "acknowledge goal" }));

    expect(
      screen.getByText("Goal mode on: Codex dispatches will follow a long-running goal."),
    ).toBeTruthy();
  });

  it("reflects a goal mode rehydrated from the channel", () => {
    render(<IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />);

    const goalToggle = screen.getByRole("checkbox", { name: /codex goal mode/i });
    expect(goalToggle).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "hydrate goal" }));

    expect(goalToggle).toBeChecked();
  });

  it("requests a Codex dispatch and surfaces the confirmation", () => {
    render(<IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />);

    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent("dispatch=0");

    fireEvent.click(screen.getByRole("button", { name: /dispatch to codex/i }));

    expect(screen.getByTestId("project-assistant-panel")).toHaveTextContent("dispatch=1");
    expect(screen.getByText("Dispatching to Codex...")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "confirm dispatch" }));

    expect(screen.getByText("Requested Codex work on MAC-1")).toBeTruthy();
  });

  it("surfaces a dispatch error", () => {
    render(<IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />);

    fireEvent.click(screen.getByRole("button", { name: /dispatch to codex/i }));
    fireEvent.click(screen.getByRole("button", { name: "fail dispatch" }));

    expect(screen.getByText("dispatch failed")).toBeTruthy();
  });

  it("reflects a mode rehydrated from the channel without a fresh selection", () => {
    render(<IssueAuthoringPanel projectSlug="macro-markets" identifier="MAC-1" view="board" />);

    expect(screen.getByRole("button", { name: "Complex" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "hydrate complex" }));

    expect(screen.getByRole("button", { name: "Complex" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Complex mode active.")).toBeTruthy();
  });
});
