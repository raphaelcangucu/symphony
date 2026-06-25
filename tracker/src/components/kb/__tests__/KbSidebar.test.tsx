import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { KbSidebar } from "@/components/kb/KbSidebar";
import type { KbProjectOverview, KbTreeNode } from "@/types/knowledgeBase";

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
  web: [{ type: "page", name: "index.md", path: "index.md", title: "Home", order: null, children: [] }],
};

describe("KbSidebar", () => {
  it("renders a section per repository and pages under it", () => {
    render(
      <MemoryRouter>
        <KbSidebar
          projectSlug="acme"
          overview={overview}
          treesByRepo={treesByRepo}
          activeRepo="web"
          activePath="index.md"
          onSelectRepo={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("services/api")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/projects/acme/kb/web/index.md",
    );
  });
});
