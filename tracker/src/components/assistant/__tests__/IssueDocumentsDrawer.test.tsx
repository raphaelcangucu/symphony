import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";

const knowledgeBaseModal = vi.fn(
  ({ open, projectSlug }: { open: boolean; projectSlug: string }) =>
    open ? <section aria-label="mock KB modal">KB modal {projectSlug}</section> : null,
);

vi.mock("@/components/kb/KnowledgeBaseModal", () => ({
  KnowledgeBaseModal: (props: Parameters<typeof knowledgeBaseModal>[0]) =>
    knowledgeBaseModal(props),
}));

describe("IssueDocumentsDrawer", () => {
  it("opens the shared project KB modal instead of a documents drawer", () => {
    render(<IssueDocumentsDrawer projectSlug="macro-markets" identifier="MAC-1" />);

    fireEvent.click(screen.getByRole("button", { name: /documents/i }));

    expect(screen.getByRole("region", { name: "mock KB modal" })).toHaveTextContent("KB modal macro-markets");
    expect(knowledgeBaseModal).toHaveBeenLastCalledWith({
      open: true,
      projectSlug: "macro-markets",
      onOpenChange: expect.any(Function),
    });
  });
});
