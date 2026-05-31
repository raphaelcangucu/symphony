import { render, screen } from "@testing-library/react";
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
      Assistant {projectSlug}:{issueIdentifier}:{view}:{mode}
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
      "Assistant macro-markets:MAC-1:list:embedded",
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
});
