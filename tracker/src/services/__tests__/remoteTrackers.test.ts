import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverGitHubProjects, discoverLinearProjects } from "@/services/remoteTrackers";
import { http } from "@/services/http";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { post: vi.fn() } };
});

describe("remoteTrackers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discoverGitHubProjects maps response", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: "PVT_1", number: 7, title: "Roadmap", owner: { login: "o", kind: "user" } }] },
    });

    const result = await discoverGitHubProjects();
    expect(result[0]).toEqual({
      id: "PVT_1",
      number: 7,
      title: "Roadmap",
      owner: { login: "o", kind: "user" },
      repoNameWithOwner: null,
    });
  });

  it("discoverLinearProjects maps response", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: "p1", slugId: "s", name: "Proj", state: "started", team: { id: "t", name: "Team" } }] },
    });

    const result = await discoverLinearProjects();
    expect(result[0].name).toBe("Proj");
    expect(result[0].team.name).toBe("Team");
  });
});
