import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";

import { KbSidebar } from "@/components/kb/KbSidebar";
import { i18n, initI18n } from "@/i18n";
import type { KbProjectOverview, KbTreeNode } from "@/types/knowledgeBase";

await initI18n("en");

const overview: KbProjectOverview = {
  project: { slug: "acme", name: "Acme" },
  repositories: [
    { repoSlug: "web", workspacePath: "web", githubFullName: "acme/web", role: "frontend", docsPresent: true },
    {
      repoSlug: "services~api",
      workspacePath: "services/api",
      githubFullName: "acme/api",
      role: "backend",
      docsPresent: false,
    },
  ],
};

const treesByRepo: Record<string, KbTreeNode[]> = {
  web: [
    {
      type: "page",
      name: "index.md",
      path: "index.md",
      title: "Home",
      order: null,
      favorite: false,
      children: [],
    },
  ],
};

const treeHandlers = {
  onReorder: vi.fn(),
  onRename: vi.fn(),
  onToggleFavorite: vi.fn(),
  onDelete: vi.fn(),
  onCreateFolder: vi.fn(),
  onStartAddPage: vi.fn(),
};

describe("KbSidebar", () => {
  it("renders a section per repository and pages under it", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <KbSidebar
          projectSlug="acme"
          overview={overview}
          treesByRepo={treesByRepo}
          activeRepo="web"
          activePath="index.md"
          onSelectRepo={() => {}}
          onSearchSelect={() => {}}
          treeHandlers={treeHandlers}
          inlineEdit={{
            draft: null,
            rename: null,
            onDraftSubmit: () => {},
            onRenameSubmit: () => {},
            onCancel: () => {},
          }}
        />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("services/api")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/projects/acme/kb/web/index.md",
    );
    expect(screen.getByText("Search")).toBeInTheDocument();
  });
});
