import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";

const assistantKbDocumentsPanel = vi.fn(
  ({ projectSlug, issueIdentifier, citedPaths }: { projectSlug: string; issueIdentifier?: string; citedPaths: string[] }) => (
    <section aria-label="mock KB panel">
      KB {projectSlug}:{issueIdentifier ?? "none"} cited:{citedPaths.join(",") || "none"}
    </section>
  ),
);

vi.mock("@/components/assistant/AssistantKbDocumentsPanel", () => ({
  AssistantKbDocumentsPanel: (props: Parameters<typeof assistantKbDocumentsPanel>[0]) =>
    assistantKbDocumentsPanel(props),
}));

describe("IssueDocumentsDrawer", () => {
  it("opens the project KB panel instead of issue workspace documents", () => {
    render(<IssueDocumentsDrawer projectSlug="macro-markets" identifier="MAC-1" />);

    fireEvent.click(screen.getByRole("button", { name: /documents/i }));

    expect(screen.getByRole("region", { name: "mock KB panel" })).toHaveTextContent(
      "KB macro-markets:MAC-1 cited:none",
    );
    expect(assistantKbDocumentsPanel).toHaveBeenCalledWith({
      projectSlug: "macro-markets",
      issueIdentifier: "MAC-1",
      citedPaths: [],
      className: "rounded-none border-0 shadow-none",
    });
  });
});
