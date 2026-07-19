import { describe, expect, it } from "vitest";

import {
  compareDockerContainers,
  groupDockerContainersByProject,
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

describe("groupDockerContainersByProject", () => {
  it("groups containers by compose project with unassigned last", () => {
    const containers = [
      container({ id: "1".repeat(64), name: "solo", composeProject: null }),
      container({ id: "2".repeat(64), name: "web", composeProject: "backend", composeWorkingDir: "/a" }),
      container({ id: "3".repeat(64), name: "api", composeProject: "mac-21", composeWorkingDir: "/b" }),
    ];

    const groups = groupDockerContainersByProject(containers, "name", true);
    expect(groups.map((group) => group.composeProject)).toEqual(["backend", "mac-21", null]);
    expect(groups[0]?.containers.map((item) => item.name)).toEqual(["web"]);
    expect(groups[2]?.containers.map((item) => item.name)).toEqual(["solo"]);
  });

  it("splits the same compose project when working directories differ", () => {
    const containers = [
      container({
        id: "1".repeat(64),
        name: "app-a",
        composeProject: "backend",
        composeWorkingDir: "/gam-7/backend",
      }),
      container({
        id: "2".repeat(64),
        name: "app-b",
        composeProject: "backend",
        composeWorkingDir: "/gam-19/backend",
      }),
    ];

    const groups = groupDockerContainersByProject(containers, "name", true);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.composeWorkingDir).sort()).toEqual(["/gam-19/backend", "/gam-7/backend"].sort());
  });

  it("sorts containers inside each group by the selected key", () => {
    const containers = [
      container({ id: "1".repeat(64), name: "z-app", composeProject: "demo" }),
      container({ id: "2".repeat(64), name: "a-app", composeProject: "demo" }),
    ];

    const groups = groupDockerContainersByProject(containers, "name", true);
    expect(groups[0]?.containers.map((item) => item.name)).toEqual(["a-app", "z-app"]);
  });
});
