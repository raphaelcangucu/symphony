import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EditProjectDialog } from "@/components/projects/EditProjectDialog";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import type { Project } from "@/types/project";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");

function localProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "3",
    slug: "macro-markets",
    name: "Macro Markets",
    description: "A board",
    tracker: { kind: "local", config: {} },
    ...overrides,
  };
}

describe("EditProjectDialog", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves edited name and description for a local project", async () => {
    const updated = localProject({ name: "Renamed" });
    vi.mocked(projects.updateProject).mockResolvedValue(updated);
    vi.mocked(projects.updateProjectSetup).mockResolvedValue(updated);
    const onSaved = vi.fn();

    render(<EditProjectDialog project={localProject()} open onOpenChange={vi.fn()} onSaved={onSaved} />);

    const nameInput = screen.getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(projects.updateProject).toHaveBeenCalledTimes(1));
    expect(projects.updateProject).toHaveBeenCalledWith("macro-markets", {
      name: "Renamed",
      description: "A board",
      tracker: { kind: "local", config: {} },
    });
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it("connects a GitHub board picked from discovery", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([
      {
        id: "PVT_kwDOCpPais4BY509",
        number: 2,
        title: "Macro Markets",
        owner: { login: "clouapp", kind: "organization" },
        repoNameWithOwner: "clouapp/front",
      },
    ]);
    const updated = localProject({
      tracker: { kind: "github", config: { project_id: "PVT_kwDOCpPais4BY509" } },
    });
    vi.mocked(projects.updateProject).mockResolvedValue(updated);

    render(<EditProjectDialog project={localProject()} open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("radio", { name: /GitHub Project v2/i }));
    await waitFor(() => expect(screen.getByText("Macro Markets", { selector: "span" })).toBeInTheDocument());
    await userEvent.click(screen.getByText("Macro Markets", { selector: "span" }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(projects.updateProject).toHaveBeenCalledTimes(1));
    expect(projects.updateProject).toHaveBeenCalledWith("macro-markets", {
      name: "Macro Markets",
      description: "A board",
      tracker: {
        kind: "github",
        config: {
          project_id: "PVT_kwDOCpPais4BY509",
          project_number: 2,
          repo: "clouapp/front",
          status_field: "Status",
        },
      },
    });
  });

  it("shows which GitHub board the project is connected to with a link", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([
      {
        id: "PVT_kwDOCpPais4BY509",
        number: 2,
        title: "Macro Markets",
        owner: { login: "clouapp", kind: "organization" },
        repoNameWithOwner: "clouapp/front",
      },
    ]);

    const connected = localProject({
      tracker: {
        kind: "github",
        config: { project_id: "PVT_kwDOCpPais4BY509", project_number: 2, repo: "clouapp/front", status_field: "Status" },
      },
    });

    render(<EditProjectDialog project={connected} open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText("Connected board")).toBeInTheDocument();
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /Open on GitHub/i });
      expect(link).toHaveAttribute("href", "https://github.com/orgs/clouapp/projects/2");
    });
  });

  it("saves prompt via updateProjectSetup on save", async () => {
    const fixture = localProject({ setup: { promptTemplate: "Old prompt", validationCommands: [] } });
    const updateSetup = vi.mocked(projects.updateProjectSetup).mockResolvedValue(fixture);
    vi.mocked(projects.updateProject).mockResolvedValue(fixture);
    const onSaved = vi.fn();

    render(<EditProjectDialog project={fixture} open onOpenChange={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByRole("textbox", { name: /prompt/i }), { target: { value: "New prompt" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(updateSetup).toHaveBeenCalledWith("macro-markets", expect.objectContaining({ promptTemplate: "New prompt" })),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(fixture));
  });

  it("blocks saving a GitHub source without a selected board", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);

    render(<EditProjectDialog project={localProject()} open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("radio", { name: /GitHub Project v2/i }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(projects.updateProject).not.toHaveBeenCalled();
  });
});
