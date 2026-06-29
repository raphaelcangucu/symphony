import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";

const assistantKbDocumentsPanel = vi.fn(
  ({ projectSlug, citedPaths }: { projectSlug: string; citedPaths: string[] }) => (
    <section aria-label="mock KB panel">
      KB {projectSlug} cited:{citedPaths.join(",") || "none"}
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
      "KB macro-markets cited:none",
    );
    expect(assistantKbDocumentsPanel).toHaveBeenCalledWith({
      projectSlug: "macro-markets",
      citedPaths: [],
      className: "rounded-none border-0 shadow-none",
    });
  });
});
