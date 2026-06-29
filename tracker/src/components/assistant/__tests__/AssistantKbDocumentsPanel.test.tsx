import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { AssistantKbDocumentsPanel } from "@/components/assistant/AssistantKbDocumentsPanel";
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
          name: "polymarket-omnibus-spec.md",
          path: "market/polymarket-omnibus-spec.md",
          title: "Polymarket omnibus spec",
          order: null,
          favorite: false,
          children: [],
        },
        {
          type: "page",
          name: "polymarket-omnibus-plan.md",
          path: "market/polymarket-omnibus-plan.md",
          title: "Polymarket omnibus plan",
          order: null,
          favorite: false,
          children: [],
        },
      ],
    },
  ],
};

vi.mock("@/hooks/useKbProjectOverview", () => ({
  useKbProjectOverview: () => ({ overview, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock("@/hooks/useKbAllRepoTrees", () => ({
  useKbAllRepoTrees: () => ({ treesByRepo, loading: false, reloadRepo: vi.fn(), reloadAll: vi.fn() }),
}));

vi.mock("@/hooks/useKbPage", () => ({
  useKbPage: (_projectSlug: string, _repoSlug: string | null, path: string | null) => ({
    page: path
      ? {
          path,
          title: path.endsWith("plan.md") ? "Polymarket omnibus plan" : "Polymarket omnibus spec",
          frontmatter: {},
          body: path.endsWith("plan.md") ? "# Implementation plan" : "# Product spec",
          markdown: "",
        }
      : null,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

describe("AssistantKbDocumentsPanel", () => {
  it("starts with cited KB docs and can switch to all docs", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AssistantKbDocumentsPanel
          projectSlug="macro-markets"
          citedPaths={["market/polymarket-omnibus-spec.md"]}
        />
      </I18nextProvider>,
    );

    expect(screen.getByRole("button", { name: "Polymarket omnibus spec" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Polymarket omnibus plan" })).not.toBeInTheDocument();
    expect(screen.getByText("Product spec")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All docs" }));

    expect(screen.getByRole("button", { name: "Polymarket omnibus spec" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Polymarket omnibus plan" })).toBeInTheDocument();
  });
});
