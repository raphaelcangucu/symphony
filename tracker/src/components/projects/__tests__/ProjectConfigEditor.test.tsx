import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectConfigEditor } from "@/components/projects/ProjectConfigEditor";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import type { Project } from "@/types/project";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");

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
      promptTemplate: "Old prompt",
      validationCommands: ["pnpm test"],
      workflowConfig: { tracker: { active_states: ["Todo"] }, agent: { max_turns: 40 } },
    },
    ...overrides,
  };
}

describe("ProjectConfigEditor", () => {
  afterEach(() => vi.clearAllMocks());

  it("hydrates the States tab from existing workflow_config", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    render(<ProjectConfigEditor project={project()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("tab", { name: /states/i }));
    const activeStates = within(screen.getByText("Active states").closest("div") as HTMLElement);
    expect(activeStates.getByRole("button", { name: "Todo", pressed: true })).toBeInTheDocument();
    expect(activeStates.getByRole("button", { name: "In Progress", pressed: false })).toBeInTheDocument();
  });

  it("saves project fields and pruned workflow_config", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    const saved = project();
    vi.mocked(projects.updateProject).mockResolvedValue(saved);
    vi.mocked(projects.updateProjectSetup).mockResolvedValue(saved);
    const onSaved = vi.fn();

    render(<ProjectConfigEditor project={project()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole("tab", { name: /states/i }));
    const activeStates = within(screen.getByText("Active states").closest("div") as HTMLElement);
    await userEvent.click(activeStates.getByRole("button", { name: "In Progress" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(projects.updateProject).toHaveBeenCalledTimes(1));
    expect(projects.updateProjectSetup).toHaveBeenCalledWith(
      "macro-markets",
      expect.objectContaining({
        promptTemplate: "Old prompt",
        validationCommands: ["pnpm test"],
        workflowConfig: expect.objectContaining({
          tracker: { active_states: ["Todo", "In Progress"] },
          agent: { max_turns: 40 },
        }),
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  it("surfaces a backend validation error without calling onSaved", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projects.updateProject).mockResolvedValue(project());
    vi.mocked(projects.updateProjectSetup).mockRejectedValue(new Error("invalid workflow_config: agent.max_turns must be positive"));
    const onSaved = vi.fn();

    render(<ProjectConfigEditor project={project()} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(projects.updateProjectSetup).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(await screen.findByText(/invalid workflow_config/i)).toBeInTheDocument();
  });
});
