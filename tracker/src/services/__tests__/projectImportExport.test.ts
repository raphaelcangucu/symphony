import { describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { exportProject, importProject, importProjectConfig } from "@/services/projectImportExport";

vi.mock("@/services/http", () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
  },
  trackerPath: (path: string) => `/api/tracker/v1${path}`,
  unwrapData: <T,>(response: { data: { data: T } }) => response.data.data,
}));

describe("projectImportExport service", () => {
  it("exportProject requests YAML text", async () => {
    vi.mocked(http.get).mockResolvedValue({ data: "kind: symphony_project\n" });
    await expect(exportProject("gamba")).resolves.toContain("symphony_project");
    expect(http.get).toHaveBeenCalledWith(expect.stringContaining("/projects/gamba/export"), { responseType: "text" });
  });

  it("importProject posts yaml", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: {
          id: "1",
          slug: "gamba",
          name: "Gamba",
          description: null,
          tracker: { kind: "local", config: {} },
        },
      },
    });

    await importProject("slug: gamba\nname: Gamba\n");
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining("/projects/import"), { yaml: "slug: gamba\nname: Gamba\n" });
  });

  it("importProjectConfig posts yaml to project import endpoint", async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: {
        data: {
          id: "1",
          slug: "gamba",
          name: "Gamba",
          description: null,
          tracker: { kind: "local", config: {} },
        },
      },
    });

    await importProjectConfig("gamba", "slug: gamba\nname: Gamba\n");
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining("/projects/gamba/import"), {
      yaml: "slug: gamba\nname: Gamba\n",
    });
  });
});
