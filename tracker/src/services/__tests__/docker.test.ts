import { describe, expect, it } from "vitest";

import {
  compareDockerContainers,
  mapDockerContainer,
  type DockerContainer,
} from "../docker";

function container(overrides: Partial<DockerContainer>): DockerContainer {
  return {
    id: "a".repeat(64),
    name: "web",
    image: "nginx",
    state: "running",
    status: "Up",
    ports: "",
    createdAt: "",
    composeProject: null,
    composeWorkingDir: null,
    cpuPercent: null,
    memoryUsage: null,
    ...overrides,
  };
}

describe("mapDockerContainer", () => {
  it("maps snake_case backend fields and defaults missing values", () => {
    const mapped = mapDockerContainer({
      id: "abc",
      name: "betting-app",
      image: "sail-8.5/app",
      state: "running",
      status: "Up 38 minutes",
      ports: "0.0.0.0:80->80/tcp",
      created_at: "2026-07-17",
      compose_project: "backend",
      compose_working_dir: "/home/user/backend",
      cpu_percent: "0.57%",
      memory_usage: "512MiB / 45.94GiB",
    });

    expect(mapped).toEqual({
      id: "abc",
      name: "betting-app",
      image: "sail-8.5/app",
      state: "running",
      status: "Up 38 minutes",
      ports: "0.0.0.0:80->80/tcp",
      createdAt: "2026-07-17",
      composeProject: "backend",
      composeWorkingDir: "/home/user/backend",
      cpuPercent: "0.57%",
      memoryUsage: "512MiB / 45.94GiB",
    });
  });

  it("defaults null and missing fields", () => {
    const mapped = mapDockerContainer({});
    expect(mapped.name).toBe("");
    expect(mapped.composeProject).toBeNull();
    expect(mapped.cpuPercent).toBeNull();
  });
});

describe("compareDockerContainers", () => {
  it("sorts strings case-insensitively with null compose projects last", () => {
    const a = container({ composeProject: "backend" });
    const b = container({ composeProject: null });
    expect(compareDockerContainers(a, b, "composeProject")).toBeLessThan(0);
    expect(compareDockerContainers(b, a, "composeProject")).toBeGreaterThan(0);
  });

  it("sorts cpuPercent numerically treating missing values as lowest", () => {
    const low = container({ cpuPercent: "0.5%" });
    const high = container({ cpuPercent: "17.4%" });
    const none = container({ cpuPercent: null });
    expect(compareDockerContainers(low, high, "cpuPercent")).toBeLessThan(0);
    expect(compareDockerContainers(none, low, "cpuPercent")).toBeLessThan(0);
  });
});
