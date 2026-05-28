import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectListPage } from "@/pages/ProjectListPage";
import { listProjects, createWorkspaceProject } from "@/services/projects";
import { listGitHubOwners, listGitHubRepositories, scanRepositories, suggestWorkspaceSetup } from "@/services/projectSetup";

vi.mock("@/services/projects", () => ({
  createWorkspaceProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("@/services/projectSetup", () => ({
  listGitHubOwners: vi.fn(),
  listGitHubRepositories: vi.fn(),
  scanRepositories: vi.fn(),
  suggestWorkspaceSetup: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("ProjectListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });

    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route path="/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route path="/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route path="/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("No projects returned by the tracker API.");

    fireEvent.click(screen.getByRole("button", { name: "New workspace project" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Route not found"));
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(listGitHubOwners).toHaveBeenCalledTimes(1);
  });
});
