import { describe, expect, it, vi, beforeEach } from "vitest";
import { proposeDevEnvSteps, saveDevEnvSteps, listDevEnvSteps } from "@/services/devEnv";
import { http } from "@/services/http";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});

describe("devEnv service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proposeDevEnvSteps maps proposals", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ description: "Install", command: "mix deps.get", working_dir: "api", source: "heuristic", optional: false }] },
    });
    const result = await proposeDevEnvSteps("p");
    expect(result[0]).toEqual({ description: "Install", command: "mix deps.get", workingDir: "api", source: "heuristic", optional: false });
  });

  it("saveDevEnvSteps posts snake_case steps", async () => {
    (http.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] } });
    await saveDevEnvSteps("p", [{ description: "Install", command: "mix deps.get", workingDir: "api", source: "manual", optional: false }]);
    expect(http.put).toHaveBeenCalledWith(
      expect.stringContaining("/projects/p/dev_env/steps"),
      { steps: [expect.objectContaining({ command: "mix deps.get", working_dir: "api" })] },
    );
  });

  it("listDevEnvSteps maps response", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: 1, description: "Install", command: "mix deps.get", working_dir: null, position: 0, source: "manual", optional: false }] },
    });
    const result = await listDevEnvSteps("p");
    expect(result[0].id).toBe("1");
  });
});
