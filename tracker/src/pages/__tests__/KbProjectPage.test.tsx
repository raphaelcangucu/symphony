import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as service from "@/services/knowledgeBase";
import { KbProjectPage } from "@/pages/KbProjectPage";

describe("KbProjectPage", () => {
  it("renders the repository tree and the selected page", async () => {
    vi.spyOn(service, "getProjectOverview").mockResolvedValue({
      project: { slug: "acme", name: "Acme" },
      repositories: [
        { repoSlug: "web", workspacePath: "web", githubFullName: "acme/web", role: "frontend", docsPresent: true },
      ],
    });
    vi.spyOn(service, "getRepoTree").mockResolvedValue({
      repository: { repoSlug: "web", workspacePath: "web", githubFullName: "acme/web", role: "frontend", docsPresent: true },
      docsPresent: true,
      tree: [{ type: "page", name: "index.md", path: "index.md", title: "Home", order: null, children: [] }],
    });
    vi.spyOn(service, "getPage").mockResolvedValue({
      path: "index.md",
      title: "Home",
      frontmatter: {},
      body: "# Home",
      markdown: "# Home",
    });
    vi.spyOn(service, "getSyncStatus").mockResolvedValue({
      status: "idle",
      prNumber: null,
      prUrl: null,
      lastError: null,
      lastSyncedAt: null,
    });

    render(
      <MemoryRouter initialEntries={["/projects/acme/kb/web/index.md"]}>
        <Routes>
          <Route path="/projects/:projectSlug/kb/*" element={<KbProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("web")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("kb-editor-title")).toHaveTextContent("Home"));
  });
});
