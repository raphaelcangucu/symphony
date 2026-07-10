import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDocumentsDrawer } from "@/components/assistant/IssueDocumentsDrawer";
import { i18n, initI18n } from "@/i18n";

await initI18n("en");

const knowledgeBaseModal = vi.fn(
  ({
    open,
    projectSlug,
    issueIdentifier,
    changedDocPaths,
  }: {
    open: boolean;
    projectSlug: string;
    issueIdentifier?: string | null;
    changedDocPaths?: string[];
  }) =>
    open ? (
      <section aria-label="mock KB modal">
        KB modal {projectSlug} {issueIdentifier} {(changedDocPaths ?? []).join(",")}
      </section>
    ) : null,
);

vi.mock("@/components/kb/KnowledgeBaseModal", () => ({
  KnowledgeBaseModal: (props: Parameters<typeof knowledgeBaseModal>[0]) => knowledgeBaseModal(props),
}));

vi.mock("@/hooks/useIssueChangedDocPaths", () => ({
  useIssueChangedDocPaths: () => ({
    paths: ["superpowers/specs/a.md"],
    count: 1,
    loading: false,
    reload: vi.fn(),
  }),
}));

describe("IssueDocumentsDrawer", () => {
  beforeEach(() => {
    knowledgeBaseModal.mockClear();
  });

  it("opens the KB modal scoped to the issue with changed docs", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <IssueDocumentsDrawer projectSlug="macro-markets" identifier="MAC-1" />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("changed-docs-dot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /documents/i }));

    await waitFor(() => expect(screen.getByRole("region", { name: "mock KB modal" })).toBeInTheDocument());
    expect(knowledgeBaseModal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        projectSlug: "macro-markets",
        issueIdentifier: "MAC-1",
        changedDocPaths: ["superpowers/specs/a.md"],
        onOpenChange: expect.any(Function),
      }),
    );
  });
});
