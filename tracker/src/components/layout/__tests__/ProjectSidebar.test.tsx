import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { TRACKER_PROJECTS_CHANGED_EVENT } from "@/lib/projectEvents";
import { listProjects } from "@/services/projects";
import type { Project } from "@/types/project";

vi.mock("@/components/theme/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme toggle</button>,
}));

vi.mock("@/services/projects", () => ({
  listProjects: vi.fn(),
}));

const activeProject: Project = {
  id: "active-1",
  name: "Active Project",
  slug: "active-project",
  description: "Shipping now",
  issueCount: 2,
  archivedAt: null,
};

const removedProject: Project = {
  id: "removed-1",
  name: "Removed Project",
  slug: "removed-project",
  description: "No longer active",
  issueCount: 1,
  archivedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderProjectSidebar() {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <ProjectSidebar />
    </MemoryRouter>,
  );
}

describe("ProjectSidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("reloads active project links when projects change", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject, removedProject]).mockResolvedValueOnce([activeProject]);

    renderProjectSidebar();

    expect(await screen.findByText("Removed Project")).toBeTruthy();

    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Removed Project")).toBeNull());
    expect(screen.getByText("Active Project")).toBeTruthy();
  });

  it("keeps the newer reload result when the initial load resolves later", async () => {
    const mountLoad = deferred<Project[]>();
    const eventReload = deferred<Project[]>();
    vi.mocked(listProjects).mockReturnValueOnce(mountLoad.promise).mockReturnValueOnce(eventReload.promise);

    renderProjectSidebar();
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));

    await act(async () => {
      eventReload.resolve([activeProject]);
      await eventReload.promise;
    });
    expect(await screen.findByText("Active Project")).toBeTruthy();

    await act(async () => {
      mountLoad.resolve([removedProject]);
      await mountLoad.promise;
    });

    expect(screen.getByText("Active Project")).toBeTruthy();
    expect(screen.queryByText("Removed Project")).toBeNull();
  });

  it("removes the projects changed listener on unmount", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);

    const { unmount } = renderProjectSidebar();
    await screen.findByText("Active Project");

    unmount();
    window.dispatchEvent(new Event(TRACKER_PROJECTS_CHANGED_EVENT));

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
  });
});
