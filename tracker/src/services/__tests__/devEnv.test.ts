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
      data: {
        data: [
          {
            description: "Serve",
            command: "mix phx.server",
            working_dir: "api",
            source: "heuristic",
            optional: false,
            role: "serve",
            primary: true,
            port_env: "PORT",
            url_path: "/health",
            ready_probe: "http",
            ready_path: "/health",
          },
        ],
      },
    });
    const result = await proposeDevEnvSteps("p");
    expect(result[0]).toEqual({
      description: "Serve",
      command: "mix phx.server",
      workingDir: "api",
      source: "heuristic",
      optional: false,
      role: "serve",
      primary: true,
      portEnv: "PORT",
      urlPath: "/health",
      readyProbe: "http",
      readyPath: "/health",
    });
  });

  it("proposeDevEnvSteps fills serve defaults for setup steps", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ description: "Install", command: "mix deps.get", working_dir: "api", source: "heuristic", optional: false }] },
    });
    const result = await proposeDevEnvSteps("p");
    expect(result[0]).toMatchObject({ role: "setup", primary: false, portEnv: null, urlPath: "/", readyProbe: "tcp", readyPath: "/" });
  });

  it("saveDevEnvSteps posts snake_case steps preserving serve fields", async () => {
    (http.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] } });
    await saveDevEnvSteps("p", [
      {
        description: "Serve",
        command: "mix phx.server",
        workingDir: "api",
        source: "manual",
        optional: false,
        role: "serve",
        primary: true,
        portEnv: "PORT",
        urlPath: "/health",
        readyProbe: "http",
        readyPath: "/health",
      },
    ]);
    expect(http.put).toHaveBeenCalledWith(expect.stringContaining("/projects/p/dev_env/steps"), {
      steps: [
        expect.objectContaining({
          command: "mix phx.server",
          working_dir: "api",
          role: "serve",
          primary: true,
          port_env: "PORT",
          ready_probe: "http",
          ready_path: "/health",
          url_path: "/health",
        }),
      ],
    });
  });

  it("listDevEnvSteps maps response", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: 1, description: "Install", command: "mix deps.get", working_dir: null, position: 0, source: "manual", optional: false }] },
    });
    const result = await listDevEnvSteps("p");
    expect(result[0].id).toBe("1");
  });
});
