import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AssistantKbDocumentsPanel } from "@/components/assistant/AssistantKbDocumentsPanel";
import { i18n, initI18n } from "@/i18n";
import type { KbProjectOverview, KbTreeNode } from "@/types/knowledgeBase";

await initI18n("en");

const savePage = vi.hoisted(() => vi.fn());
const kbEditor = vi.hoisted(() =>
  vi.fn(({ title, markdown, onSave }: { title: string; markdown: string; onSave: (markdown: string) => void }) => (
    <section aria-label="mock kb editor">
      <h2>{title}</h2>
      <p>{markdown}</p>
      <button type="button" onClick={() => onSave("# Updated")}>
        Save mocked KB page
      </button>
    </section>
  )),
);

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

vi.mock("@/hooks/useKbSync", () => ({
  useKbSync: () => ({ state: null, loading: false, triggerSync: vi.fn() }),
}));

vi.mock("@/components/kb/KbEditor", () => ({
  KbEditor: (props: Parameters<typeof kbEditor>[0]) => kbEditor(props),
}));

vi.mock("@/services/knowledgeBase", async () => {
  const actual = await vi.importActual<typeof import("@/services/knowledgeBase")>("@/services/knowledgeBase");
  return {
    ...actual,
    savePage,
  };
});

describe("AssistantKbDocumentsPanel", () => {
  it("uses the KB tree and editor for cited docs, then can switch to all docs", async () => {
    savePage.mockResolvedValue({ path: "market/polymarket-omnibus-spec.md", commit: "abc", pushed: false });

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AssistantKbDocumentsPanel
            projectSlug="macro-markets"
            citedPaths={["market/polymarket-omnibus-spec.md"]}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByRole("button", { name: "Market" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Polymarket omnibus spec" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Polymarket omnibus plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "mock kb editor" })).toHaveTextContent("# Product spec");

    fireEvent.click(screen.getByRole("button", { name: "Market" }));
    expect(screen.queryByRole("link", { name: "Polymarket omnibus spec" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All docs" }));
    fireEvent.click(screen.getByRole("button", { name: "Market" }));

    expect(screen.getByRole("link", { name: "Polymarket omnibus spec" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Polymarket omnibus plan" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save mocked KB page" }));

    await waitFor(() =>
      expect(savePage).toHaveBeenCalledWith("macro-markets", "back", "market/polymarket-omnibus-spec.md", {
        frontmatter: {},
        body: "# Updated",
      }),
    );
  });
});
