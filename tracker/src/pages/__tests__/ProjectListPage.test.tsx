import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewProjectRoute } from "@/components/projects/NewProjectRoute";
import { ProjectFiltersRoute } from "@/components/projects/ProjectFiltersRoute";
import { ProjectDevEnvRoute } from "@/components/projects/ProjectDevEnvRoute";
import { ProjectListPage } from "@/pages/ProjectListPage";
import { archiveProject, createWorkspaceProject, deleteProject, listProjects, restoreProject } from "@/services/projects";
import { listGitHubOwners, listGitHubRepositories, scanRepositories, suggestWorkspaceSetup } from "@/services/projectSetup";
import type { Project } from "@/types/project";

vi.mock("@/services/projects", () => ({
  archiveProject: vi.fn(),
  createWorkspaceProject: vi.fn(),
  deleteProject: vi.fn(),
  listProjects: vi.fn(),
  restoreProject: vi.fn(),
}));

vi.mock("@/services/projectSetup", () => ({
  listGitHubOwners: vi.fn(),
  listGitHubRepositories: vi.fn(),
  scanRepositories: vi.fn(),
  suggestWorkspaceSetup: vi.fn(),
}));

vi.mock("@/components/devenv/DevEnvPanel", () => ({
  DevEnvPanel: ({ projectSlug }: { projectSlug: string }) => <div>Dev env panel for {projectSlug}</div>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const activeProject: Project = {
  id: "active-1",
  name: "Active Project",
  slug: "active-project",
  description: "Shipping now",
  issueCount: 2,
  tracker: { kind: "local", config: {} },
  archivedAt: null,
};

const archivedProject: Project = {
  id: "archived-1",
  name: "Archived Project",
  slug: "archived-project",
  description: "On ice",
  issueCount: 1,
  tracker: { kind: "local", config: {} },
  archivedAt: "2026-05-28T12:00:00Z",
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

function ProjectsIndexRoute() {
  return (
    <Route path="/projects" element={<ProjectListPage />}>
      <Route path="new" element={<NewProjectRoute />} />
      <Route path="filters" element={<ProjectFiltersRoute />} />
      <Route path=":projectSlug/dev-env" element={<ProjectDevEnvRoute />} />
    </Route>
  );
}

function renderProjectsIndex(initialEntry = "/projects") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>{ProjectsIndexRoute()}</Routes>
    </MemoryRouter>,
  );
}

function renderProjectsIndexWithBoardRoute() {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <Routes>
        {ProjectsIndexRoute()}
        <Route path="/projects/:projectSlug/board" element={<div>Project board route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function openProjectFilters() {
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
}

describe("ProjectListPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("shows ongoing projects by default and filters archived projects from the side rail", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject, archivedProject]);

    renderProjectsIndex();

    await screen.findByText("Active Project");
    await waitFor(() => expect(listProjects).toHaveBeenCalledWith({ includeArchived: true }));
    expect(screen.queryByText("Archived Project")).toBeNull();
    expect(screen.queryByText("Project focus")).toBeNull();

    openProjectFilters();

    expect(screen.getByRole("button", { name: "Ongoing" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 ongoing")).toBeTruthy();
    expect(screen.getByText("1 archived")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(screen.queryByText("Active Project")).toBeNull();
    expect(await screen.findByText("Archived Project")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archived" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("restores the status and keyword filters from the URL query params", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject, archivedProject]);

    renderProjectsIndex("/projects?status=archived");

    expect(await screen.findByText("Archived Project")).toBeTruthy();
    expect(screen.queryByText("Active Project")).toBeNull();

    openProjectFilters();
    expect(screen.getByRole("button", { name: "Archived" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens and closes project filters as a lateral modal without the gradient background", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject]);

    const { container } = renderProjectsIndex();

    await screen.findByText("Active Project");
    expect(container.firstElementChild?.className).not.toContain("radial-gradient");
    expect(screen.queryByText("Project focus")).toBeNull();

    openProjectFilters();

    const filtersDialog = screen.getByRole("dialog", { name: "Project focus" });
    expect(filtersDialog.className).toContain("right-0");
    expect(filtersDialog.className).toContain("border-l");
    expect(filtersDialog.className).not.toContain("left-0");
    expect(screen.getByText("Project focus")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
    expect(screen.queryByText("Project focus")).toBeNull();
  });

  it("opens dev environment setup from the projects list", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject]);

    renderProjectsIndex();

    await screen.findByText("Active Project");
    fireEvent.click(screen.getByRole("button", { name: "Dev environment setup for Active Project" }));

    expect(await screen.findByRole("dialog", { name: "Dev environment setup" })).toBeTruthy();
    expect(screen.getByText("Dev env panel for active-project")).toBeTruthy();
  });

  it("filters projects by keyword across name slug and description", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject, archivedProject]);

    renderProjectsIndex();

    await screen.findByText("Active Project");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByText("Archived Project")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search projects..."), { target: { value: "ice" } });

    await waitFor(() => expect(screen.queryByText("Active Project")).toBeNull());
    expect(screen.getByText("Archived Project")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Active Project")).toBeTruthy();
    expect(screen.queryByText("Archived Project")).toBeNull();
  });

  it("archives an active project and hides it when archived projects are hidden", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(archiveProject).mockResolvedValue({ ...activeProject, archivedAt: "2026-05-28T12:00:00Z" });

    renderProjectsIndex();

    await screen.findByText("Active Project");
    fireEvent.click(screen.getByRole("button", { name: "Archive Active Project" }));

    await waitFor(() => expect(archiveProject).toHaveBeenCalledWith("active-project"));
    await waitFor(() => expect(screen.queryByText("Active Project")).toBeNull());
  });

  it("archives an active project and keeps it visible when archived projects are shown", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject]);
    vi.mocked(archiveProject).mockResolvedValue({ ...activeProject, archivedAt: "2026-05-28T12:00:00Z" });

    renderProjectsIndex();

    await screen.findByText("Active Project");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive Active Project" }));

    await waitFor(() => expect(archiveProject).toHaveBeenCalledWith("active-project"));
    expect(screen.getByText("Active Project")).toBeTruthy();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Restore Active Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Active Project permanently" })).toBeTruthy();
  });

  it("uses the latest archived visibility after an archive request resolves", async () => {
    const archiveRequest = deferred<Project>();
    vi.mocked(listProjects).mockResolvedValueOnce([activeProject]);
    vi.mocked(archiveProject).mockReturnValue(archiveRequest.promise);

    renderProjectsIndex();

    await screen.findByText("Active Project");
    fireEvent.click(screen.getByRole("button", { name: "Archive Active Project" }));
    await waitFor(() => expect(archiveProject).toHaveBeenCalledWith("active-project"));
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    archiveRequest.resolve({ ...activeProject, archivedAt: "2026-05-28T12:00:00Z" });

    expect(await screen.findByText("Active Project")).toBeTruthy();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Restore Active Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Active Project permanently" })).toBeTruthy();
  });

  it("shows archived project status and lifecycle actions", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([archivedProject]);

    renderProjectsIndex();

    await screen.findByText("No projects match your filters.");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("Archived Project")).toBeTruthy();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Restore Archived Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Archived Project permanently" })).toBeTruthy();
  });

  it("restores an archived project and updates the card state", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([archivedProject]);
    vi.mocked(restoreProject).mockResolvedValue({ ...archivedProject, archivedAt: null, issueCount: 4 });

    renderProjectsIndex();

    await screen.findByText("No projects match your filters.");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Archived Project");
    fireEvent.click(screen.getByRole("button", { name: "Restore Archived Project" }));

    await waitFor(() => expect(restoreProject).toHaveBeenCalledWith("archived-project"));
    expect(await screen.findByText("4 issues")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore Archived Project" })).toBeNull();
    expect(screen.getByRole("button", { name: "Archive Archived Project" })).toBeTruthy();
  });

  it("does not delete an archived project when permanent deletion is cancelled", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([archivedProject]);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderProjectsIndex();

    await screen.findByText("No projects match your filters.");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Archived Project");
    fireEvent.click(screen.getByRole("button", { name: "Delete Archived Project permanently" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete project "Archived Project" permanently? This cannot be undone.');
    expect(deleteProject).not.toHaveBeenCalled();
    expect(screen.getByText("Archived Project")).toBeTruthy();
  });

  it("deletes an archived project when permanent deletion is confirmed", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([archivedProject]);
    vi.mocked(deleteProject).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderProjectsIndex();

    await screen.findByText("No projects match your filters.");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Archived Project");
    fireEvent.click(screen.getByRole("button", { name: "Delete Archived Project permanently" }));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("archived-project"));
    await waitFor(() => expect(screen.queryByText("Archived Project")).toBeNull());
  });

  it("shows a toast when loading projects fails", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("Unable to load project filters"));

    renderProjectsIndex();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to load project filters"));
    expect(screen.getByText("No projects returned by the tracker API.")).toBeTruthy();
  });

  it("keeps an active project visible and shows a toast when archiving fails", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(archiveProject).mockRejectedValue(new Error("Archive failed"));

    renderProjectsIndex();

    await screen.findByText("Active Project");
    fireEvent.click(screen.getByRole("button", { name: "Archive Active Project" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Archive failed"));
    expect(screen.getByText("Active Project")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore Active Project" })).toBeNull();
    expect(screen.getByRole("button", { name: "Archive Active Project" })).toBeTruthy();
  });

  it("keeps an archived project unchanged and shows a toast when restoring fails", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([archivedProject]);
    vi.mocked(restoreProject).mockRejectedValue(new Error("Restore failed"));

    renderProjectsIndex();

    await screen.findByText("No projects match your filters.");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Archived Project");
    fireEvent.click(screen.getByRole("button", { name: "Restore Archived Project" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Restore failed"));
    expect(screen.getByText("Archived Project")).toBeTruthy();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Restore Archived Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Archived Project permanently" })).toBeTruthy();
  });

  it("keeps an archived project visible and shows a toast when permanent deletion fails", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([archivedProject]);
    vi.mocked(deleteProject).mockRejectedValue(new Error("Delete failed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderProjectsIndex();

    await screen.findByText("No projects match your filters.");
    openProjectFilters();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await screen.findByText("Archived Project");
    fireEvent.click(screen.getByRole("button", { name: "Delete Archived Project permanently" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Delete failed"));
    expect(screen.getByText("Archived Project")).toBeTruthy();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Delete Archived Project permanently" })).toBeTruthy();
  });

  it("navigates from project card links but not from lifecycle actions", async () => {
    vi.mocked(listProjects).mockResolvedValue([activeProject]);
    vi.mocked(archiveProject).mockRejectedValue(new Error("Archive failed"));

    renderProjectsIndexWithBoardRoute();

    await screen.findByText("Active Project");
    fireEvent.click(screen.getByRole("button", { name: "Archive Active Project" }));

    await waitFor(() => expect(archiveProject).toHaveBeenCalledWith("active-project"));
    expect(screen.queryByText("Project board route")).toBeNull();
    expect(screen.getByText("Active Project")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: /Active Project/ }));

    expect(await screen.findByText("Project board route")).toBeTruthy();
  });

  it("creates a workspace project from GitHub repository suggestions", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listGitHubOwners).mockResolvedValue([
      {
        login: "clouapp",
        name: "Clou App",
        avatarUrl: "https://github.com/clouapp.png",
        kind: "organization",
      },
    ]);
    vi.mocked(listGitHubRepositories).mockResolvedValue([
      {
        name: "front",
        fullName: "clouapp/front",
        cloneUrl: "https://github.com/clouapp/front.git",
        defaultBranch: "homolog",
        selectedBranch: "homolog",
        avatarUrl: "https://github.com/clouapp.png",
        suggestedLocalPath: "/code/front",
        localPath: "/code/front",
        workspacePath: "frontend",
        role: "frontend",
      },
    ]);
    vi.mocked(scanRepositories).mockResolvedValue([
      {
        localPath: "/code/front",
        workspacePath: "frontend",
        stack: ["node"],
        packageManager: "pnpm",
        validationCommands: ["pnpm test"],
      },
    ]);
    vi.mocked(suggestWorkspaceSetup).mockResolvedValue({
      workflowStatuses: [{ id: "todo", name: "Todo", category: "active", position: 0, isTerminal: false }],
      workflowConfig: { active_states: ["Todo"] },
      validationCommands: ["pnpm test"],
      afterCreateHook: "git clone --branch homolog https://github.com/clouapp/front.git frontend",
      promptTemplate: "Use frontend/.",
      scanSummary: { repository_count: 1 },
    });
    vi.mocked(createWorkspaceProject).mockResolvedValue({
      id: "1",
      name: "Macro Markets",
      slug: "macro-markets",
      description: null,
      issueCount: 0,
      workflowStatuses: [{ id: "todo", name: "Todo", category: "active", position: 0, isTerminal: false }],
      repositories: [{ fullName: "clouapp/front", workspacePath: "frontend", role: "frontend" }],
      setup: { validationCommands: ["pnpm test"] },
      tracker: { kind: "local", config: {} },
    });

    renderProjectsIndex();

    await screen.findByText("No projects returned by the tracker API.");

    fireEvent.click(screen.getByRole("button", { name: "New workspace project" }));
    fireEvent.change(screen.getByPlaceholderText("Project name"), { target: { value: "Macro Markets" } });
    fireEvent.change(screen.getByPlaceholderText("project-slug"), { target: { value: "macro-markets" } });
    await screen.findByRole("button", { name: /Clou App/ });
    fireEvent.click(screen.getByRole("button", { name: /Clou App/ }));
    await screen.findByLabelText("clouapp/front");
    fireEvent.click(screen.getByLabelText("clouapp/front"));
    expect(screen.queryByDisplayValue("/code/front")).toBeNull();
    expect(screen.getByText("macro-markets/front")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit scan path for clouapp/front" }));
    expect(screen.getByDisplayValue("/code/front")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan and suggest" }));
    await screen.findByText("pnpm test");
    fireEvent.click(screen.getByRole("button", { name: "Create workspace project" }));

    await waitFor(() =>
      expect(createWorkspaceProject).toHaveBeenCalledWith({
        name: "Macro Markets",
        slug: "macro-markets",
        description: null,
        workflowStatuses: [{ id: "todo", name: "Todo", category: "active", position: 0, isTerminal: false }],
        repositories: [
          {
            name: "front",
            fullName: "clouapp/front",
            cloneUrl: "https://github.com/clouapp/front.git",
            defaultBranch: "homolog",
            selectedBranch: "homolog",
            avatarUrl: "https://github.com/clouapp.png",
            suggestedLocalPath: "/code/front",
            workspacePath: "macro-markets/front",
            role: "frontend",
            localPath: "/code/front",
          },
        ],
        setup: {
          workflowConfig: { active_states: ["Todo"] },
          validationCommands: ["pnpm test"],
          afterCreateHook: "git clone --branch homolog https://github.com/clouapp/front.git frontend",
          promptTemplate: "Use frontend/.",
          scanSummary: { repository_count: 1 },
        },
      }),
    );

    expect(screen.getByText("Macro Markets")).toBeTruthy();
  });

  it("hides the suggested scan path and places repositories under the project slug", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listGitHubOwners).mockResolvedValue([
      {
        login: "clouapp",
        name: "Clou App",
        avatarUrl: "https://github.com/clouapp.png",
        kind: "organization",
      },
    ]);
    vi.mocked(listGitHubRepositories).mockResolvedValue([
      {
        name: "front",
        fullName: "clouapp/front",
        cloneUrl: "https://github.com/clouapp/front.git",
        defaultBranch: "homolog",
        selectedBranch: "homolog",
        avatarUrl: "https://github.com/clouapp.png",
        suggestedLocalPath: "/code/front",
        localPath: "/code/front",
        workspacePath: "",
        role: "frontend",
      },
    ]);

    renderProjectsIndex();

    await screen.findByText("No projects returned by the tracker API.");

    fireEvent.click(screen.getByRole("button", { name: "New workspace project" }));
    fireEvent.change(screen.getByPlaceholderText("project-slug"), { target: { value: "macro-markets" } });
    await screen.findByRole("button", { name: /Clou App/ });
    fireEvent.click(screen.getByRole("button", { name: /Clou App/ }));
    await screen.findByLabelText("clouapp/front");
    fireEvent.click(screen.getByLabelText("clouapp/front"));

    expect(screen.getByText("macro-markets/front")).toBeTruthy();
    expect(screen.queryByDisplayValue("/code/front")).toBeNull();
    expect(screen.queryByText("Suggested from repository name. The scan only reads files from this path.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit scan path for clouapp/front" }));

    const scanPathInput = screen.getByLabelText("Local scan path for clouapp/front") as HTMLInputElement;
    expect(scanPathInput.value).toBe("/code/front");
  });

  it("does not retry GitHub owner discovery forever when the API fails", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listGitHubOwners).mockRejectedValue(new Error("Route not found"));

    renderProjectsIndex();

    await screen.findByText("No projects returned by the tracker API.");

    fireEvent.click(screen.getByRole("button", { name: "New workspace project" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Route not found"));
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(listGitHubOwners).toHaveBeenCalledTimes(1);
  });
});
