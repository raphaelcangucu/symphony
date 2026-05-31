import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

  it("blocks saving a GitHub source without a selected board", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);

    render(<EditProjectDialog project={localProject()} open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("radio", { name: /GitHub Project v2/i }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(projects.updateProject).not.toHaveBeenCalled();
  });
});
