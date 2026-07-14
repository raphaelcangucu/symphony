import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as service from "@/services/knowledgeBase";
import { KbProjectPage } from "@/pages/KbProjectPage";

// Capture the `assetContext` reference KbProjectPage hands to the editor on
// every render so we can assert it stays referentially stable. An unstable
// (inline object) reference makes the editor's content-load effect re-run on
// each parent re-render and wipe in-progress edits.
const assetContextRenders = vi.hoisted(() => [] as unknown[]);

vi.mock("@/components/kb/KbEditor", () => ({
  KbEditor: (props: { title: string; assetContext?: unknown; onSave: (markdown: string) => void }) => {
    assetContextRenders.push(props.assetContext);
    return (
      <div>
        <span data-testid="kb-editor-title">{props.title}</span>
        <button type="button" data-testid="kb-editor-save" onClick={() => props.onSave("# edited")}>
          editor
        </button>
      </div>
    );
  },
}));

describe("KbProjectPage", () => {
  it("renders the repository tree and the selected page", async () => {
    vi.spyOn(service, "getProjectOverview").mockResolvedValue({
      project: { slug: "acme", name: "Acme" },
      repositories: [
        { repoSlug: "web", workspacePath: "web", githubFullName: "acme/web", defaultBranch: "main", role: "frontend", docsPresent: true },
      ],
    });
    vi.spyOn(service, "getRepoTree").mockResolvedValue({
      repository: { repoSlug: "web", workspacePath: "web", githubFullName: "acme/web", defaultBranch: "main", role: "frontend", docsPresent: true },
      docsPresent: true,
      tree: [{ type: "page", name: "index.md", path: "index.md", title: "Home", order: null, favorite: false, children: [] }],
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

  it("passes a referentially stable assetContext across re-renders", async () => {
    assetContextRenders.length = 0;
    vi.spyOn(service, "getProjectOverview").mockResolvedValue({
      project: { slug: "acme", name: "Acme" },
      repositories: [
        { repoSlug: "web", workspacePath: "web", githubFullName: "acme/web", defaultBranch: "main", role: "frontend", docsPresent: true },
      ],
    });
    vi.spyOn(service, "getRepoTree").mockResolvedValue({
      repository: { repoSlug: "web", workspacePath: "web", githubFullName: "acme/web", defaultBranch: "main", role: "frontend", docsPresent: true },
      docsPresent: true,
      tree: [{ type: "page", name: "index.md", path: "index.md", title: "Home", order: null, favorite: false, children: [] }],
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
    const savePage = vi.spyOn(service, "savePage").mockResolvedValue({
      path: "index.md",
      commit: "abc",
      pushed: false,
    });

    render(
      <MemoryRouter initialEntries={["/projects/acme/kb/web/index.md"]}>
        <Routes>
          <Route path="/projects/:projectSlug/kb/*" element={<KbProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("kb-editor-save")).toBeInTheDocument());
    const rendersBeforeSave = assetContextRenders.length;
    expect(rendersBeforeSave).toBeGreaterThan(0);

    // Saving toggles `saving` state, forcing KbProjectPage to re-render twice.
    fireEvent.click(screen.getByTestId("kb-editor-save"));
    await waitFor(() => expect(savePage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(assetContextRenders.length).toBeGreaterThan(rendersBeforeSave));

    const first = assetContextRenders[0];
    expect(first).toBeTruthy();
    for (const captured of assetContextRenders) {
      expect(captured).toBe(first);
    }
  });
});
