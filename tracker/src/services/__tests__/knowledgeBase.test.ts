import { afterEach, describe, expect, it, vi } from "vitest";
import { http } from "@/services/http";
import {
  connectGeneral,
  getGeneralOverview,
  getPage,
  getProjectOverview,
  getRepoTree,
  getSyncStatus,
  regenerateGeneralHome,
  requestSync,
  savePage,
  searchProject,
} from "@/services/knowledgeBase";

vi.mock("@/services/http", async (orig) => {
  const actual = await orig<typeof import("@/services/http")>();
  return {
    ...actual,
    http: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  };
});

afterEach(() => vi.clearAllMocks());

describe("knowledgeBaseService", () => {
  it("getProjectOverview maps repositories (docs_present? key + workspace path)", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: {
          project: { slug: "acme", name: "Acme" },
          repositories: [
            {
              repo_slug: "services~api",
              workspace_path: "services/api",
              github_full_name: "acme/api",
              role: "backend",
              "docs_present?": true,
            },
          ],
        },
      },
    });

    const overview = await getProjectOverview("acme");
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb");
    expect(overview.project.name).toBe("Acme");
    expect(overview.repositories[0].repoSlug).toBe("services~api");
    expect(overview.repositories[0].workspacePath).toBe("services/api");
    expect(overview.repositories[0].docsPresent).toBe(true);
  });

  it("getRepoTree requests the repo path (no /tree suffix) and uses top-level docs_present", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: {
          repository: {
            repo_slug: "web",
            workspace_path: "web",
            github_full_name: "acme/web",
            role: "frontend",
          },
          docs_present: true,
          tree: [],
        },
      },
    });

    const result = await getRepoTree("acme", "web");
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/web");
    expect(result.docsPresent).toBe(true);
    expect(result.repository.docsPresent).toBe(true);
  });

  it("getPage maps backend `content` to `markdown`", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        data: { repo_slug: "web", path: "a.md", title: "A", frontmatter: {}, body: "b", content: "# A\n\nb" },
      },
    });

    const page = await getPage("acme", "web", "a.md");
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/web/pages/a.md");
    expect(page.markdown).toBe("# A\n\nb");
    expect(page.title).toBe("A");
  });

  it("savePage PUTs frontmatter + body and maps the result", async () => {
    (http.put as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { path: "a.md", commit: "abc", pushed: false } },
    });

    const result = await savePage("acme", "web", "a.md", { frontmatter: { title: "A" }, body: "# A" });
    expect(http.put).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/web/pages/a.md", {
      frontmatter: { title: "A" },
      body: "# A",
    });
    expect(result.commit).toBe("abc");
    expect(result.pushed).toBe(false);
  });

  it("searchProject passes q and repo params", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] } });
    await searchProject("acme", "query", { repo: "web" });
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/search", {
      params: { q: "query", repo: "web" },
    });
  });

  it("getSyncStatus and requestSync hit the sync endpoints", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { status: "idle", pr_number: null, pr_url: null, last_error: null, last_synced_at: null } },
    });
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { accepted: true } } });

    const state = await getSyncStatus("acme", "web");
    await requestSync("acme", "web");
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/web/sync");
    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/projects/acme/kb/repos/web/sync");
    expect(state.status).toBe("idle");
    expect(state.prNumber).toBeNull();
  });

  it("general KB endpoints map connection + tree", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: { connected: true, tree: [{ type: "page", name: "index.md", path: "index.md", title: "Home", order: null, favorite: false, children: [] }] } },
    });
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { connected: true } } });

    const overview = await getGeneralOverview();
    await connectGeneral();
    expect(http.get).toHaveBeenCalledWith("/api/tracker/v1/kb");
    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/kb/connect");
    expect(overview.connected).toBe(true);
    expect(overview.tree[0].path).toBe("index.md");

    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { path: "index.md", commit: "x", pushed: false } } });
    const result = await regenerateGeneralHome();
    expect(http.post).toHaveBeenCalledWith("/api/tracker/v1/kb/home");
    expect(result.path).toBe("index.md");
  });
});
