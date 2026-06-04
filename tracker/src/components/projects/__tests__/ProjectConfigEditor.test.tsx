import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectConfigEditor } from "@/components/projects/ProjectConfigEditor";
import * as projects from "@/services/projects";
import * as projectSetup from "@/services/projectSetup";
import * as remote from "@/services/remoteTrackers";
import type { Project } from "@/types/project";

vi.mock("@/services/projects");
vi.mock("@/services/projectSetup");
vi.mock("@/services/remoteTrackers");

const workflowMarkdown = `---
tracker:
  active_states: [Todo]
---
Prompt body`;

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "3",
    slug: "macro-markets",
    name: "Macro Markets",
    description: "A board",
    tracker: { kind: "local", config: {} },
    workflowStatuses: [
      { id: "1", name: "Todo", category: "active", position: 0, isTerminal: false },
      { id: "2", name: "In Progress", category: "started", position: 1, isTerminal: false },
      { id: "3", name: "Done", category: "completed", position: 2, isTerminal: true },
    ],
    setup: {
      validationCommands: ["pnpm test"],
      workflowMarkdown,
    },
    ...overrides,
  };
}

describe("ProjectConfigEditor", () => {
  afterEach(() => vi.clearAllMocks());

  it("hydrates the workflow editor from workflow_markdown", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    render(<ProjectConfigEditor project={project()} onSaved={vi.fn()} activeTab="workflow" />);

    expect(await screen.findByDisplayValue(/active_states: \[Todo\]/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Prompt body/)).toBeInTheDocument();
  });

  it("saves project fields and workflow_markdown", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    const saved = project();
    vi.mocked(projects.updateProject).mockResolvedValue(saved);
    vi.mocked(projects.updateProjectSetup).mockResolvedValue(saved);
    const onSaved = vi.fn();

    render(<ProjectConfigEditor project={project()} onSaved={onSaved} activeTab="workflow" />);

    const editor = await screen.findByLabelText(/project workflow markdown/i);
    fireEvent.change(editor, { target: { value: workflowMarkdown.replace("Todo", "In Progress") } });
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(projects.updateProject).toHaveBeenCalledTimes(1));
    expect(projects.updateProjectSetup).toHaveBeenCalledWith(
      "macro-markets",
      expect.objectContaining({
        validationCommands: ["pnpm test"],
        workflowMarkdown: expect.stringContaining("In Progress"),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  it("surfaces a backend validation error without calling onSaved", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([]);
    vi.mocked(projects.updateProject).mockResolvedValue(project());
    vi.mocked(projects.updateProjectSetup).mockRejectedValue(
      new Error("invalid workflow_markdown: agent.max_turns must be positive"),
    );
    const onSaved = vi.fn();

    render(<ProjectConfigEditor project={project()} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(projects.updateProjectSetup).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(await screen.findByText(/invalid workflow_markdown/i)).toBeInTheDocument();
  });

  it("replaces repositories only when they change", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([]);
    const withRepos = project({
      repositories: [{ fullName: "acme/web", workspacePath: "acme/web", role: "frontend", selectedBranch: "main" }],
    });
    vi.mocked(projects.updateProject).mockResolvedValue(withRepos);
    vi.mocked(projects.updateProjectRepositories).mockResolvedValue(withRepos);
    vi.mocked(projects.updateProjectSetup).mockResolvedValue(withRepos);

    render(<ProjectConfigEditor project={withRepos} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Workspace path for acme/web"), "-app");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(projects.updateProjectRepositories).toHaveBeenCalledTimes(1));
    expect(projects.updateProjectRepositories).toHaveBeenCalledWith("macro-markets", [
      expect.objectContaining({ fullName: "acme/web", workspacePath: "acme/web-app" }),
    ]);
  });

  it("does not save when the name is empty", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    const onSaved = vi.fn();

    render(<ProjectConfigEditor project={project()} onSaved={onSaved} />);

    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(projects.updateProject).not.toHaveBeenCalled();
    expect(projects.updateProjectSetup).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
