import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeBaseModal } from "@/components/kb/KnowledgeBaseModal";
import { i18n, initI18n } from "@/i18n";
import type { KbProjectOverview, KbTreeNode } from "@/types/knowledgeBase";

await initI18n("en");

const overview: KbProjectOverview = {
  project: { slug: "macro-markets", name: "Macro Markets" },
  repositories: [
    { repoSlug: "back", workspacePath: "back", githubFullName: "clouapp/back", role: "backend", docsPresent: true },
  ],
};

const treesByRepo: Record<string, KbTreeNode[]> = {
  back: [
    {
      type: "folder",
      name: "market",
      path: "market",
      title: "Market",
      order: null,
      favorite: false,
      children: [
        {
          type: "page",
          name: "changed.md",
          path: "market/changed.md",
          title: "Changed doc",
          order: null,
          favorite: false,
          children: [],
        },
        {
          type: "page",
          name: "other.md",
          path: "market/other.md",
          title: "Other doc",
          order: null,
          favorite: false,
          children: [],
        },
      ],
    },
  ],
};

vi.mock("@/hooks/useKbAllRepoTrees", () => ({
  useKbAllRepoTrees: () => ({ treesByRepo, loading: false, reloadRepo: vi.fn(), reloadAll: vi.fn() }),
}));

vi.mock("@/hooks/useKbPage", () => ({
  useKbPage: () => ({ page: null, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock("@/services/knowledgeBase", async () => {
  const actual = await vi.importActual<typeof import("@/services/knowledgeBase")>("@/services/knowledgeBase");
  return {
    ...actual,
    getProjectOverview: vi.fn(async () => overview),
  };
});

describe("KnowledgeBaseModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in changed filter when issue scope has changed paths", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <KnowledgeBaseModal
            open
            projectSlug="macro-markets"
            issueIdentifier="510"
            changedDocPaths={["market/changed.md"]}
            onOpenChange={() => undefined}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    await waitFor(() => expect(screen.getByText("Changed docs")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Changed doc" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Other doc" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All docs" }));
    expect(screen.getByRole("link", { name: "Other doc" })).toBeInTheDocument();
  });

  it("has no filter toggle without issue scope", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <KnowledgeBaseModal open projectSlug="macro-markets" onOpenChange={() => undefined} />
        </MemoryRouter>
      </I18nextProvider>,
    );

    await waitFor(() => expect(screen.getByRole("link", { name: "Changed doc" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Changed docs" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Other doc" })).toBeInTheDocument();
  });
});
