import "@testing-library/jest-dom/vitest";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { ProjectWorkspaceWizard } from "@/components/projects/ProjectWorkspaceWizard";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import * as setup from "@/services/projectSetup";
import * as templates from "@/services/templates";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");
vi.mock("@/services/projectSetup");
vi.mock("@/services/templates");

describe("ProjectWorkspaceWizard tracker step", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("creates a github-backed project through the remote tracker flow", async () => {
    const user = userEvent.setup();

    vi.mocked(setup.listGitHubOwners).mockResolvedValue([]);
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([
      {
        id: "PVT_1",
        number: 7,
        title: "Roadmap",
        owner: { login: "o", kind: "user" },
        repoNameWithOwner: "o/r",
      },
    ]);
    vi.mocked(projects.createWorkspaceProject).mockResolvedValue({
      id: "1",
      slug: "gh",
      name: "GH",
      description: null,
      tracker: { kind: "github", config: {} },
    } as never);

    render(
      <MemoryRouter>
        <ProjectWorkspaceWizard />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /new workspace project/i }));
    await user.click(screen.getByText(/GitHub Project/i));

    await waitFor(() => expect(screen.getByText(/Roadmap/)).toBeInTheDocument());
    await user.click(screen.getByText(/Roadmap/));

    await user.type(screen.getByPlaceholderText(/Project name/i), "GH");
    await user.type(screen.getByPlaceholderText(/project-slug/i), "gh");

    await user.click(screen.getByRole("button", { name: /connect|create/i }));

    await waitFor(() =>
      expect(projects.createWorkspaceProject).toHaveBeenCalledWith(
        expect.objectContaining({
          tracker: expect.objectContaining({
            kind: "github",
            config: expect.objectContaining({ project_id: "PVT_1" }),
          }),
        }),
      ),
    );
  });
});

describe("ProjectWorkspaceWizard template tab", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("instantiates a project from a template", async () => {
    vi.mocked(templates.listTemplates).mockResolvedValue([
      { id: "1", name: "Gamba", slug: "gamba", description: null, validationCommands: [], workflowStatuses: [], afterCreateHook: null, promptTemplate: null, devEnvMarkdown: null, metadata: {}, repositories: [] },
    ]);
    vi.mocked(templates.instantiateTemplate).mockResolvedValue({ id: "1", slug: "g1", name: "G1", description: null, tracker: { kind: "local", config: {} } } as never);

    render(
      <MemoryRouter>
        <ProjectWorkspaceWizard />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /new workspace project/i }));
    await userEvent.click(screen.getByRole("tab", { name: /start from a template/i }));
    await waitFor(() => expect(screen.getByText("Gamba")).toBeInTheDocument());
    await userEvent.click(screen.getByText("Gamba"));
    await userEvent.type(screen.getByPlaceholderText(/Project name/i), "G1");
    await userEvent.type(screen.getByPlaceholderText(/project-slug/i), "g1");
    await userEvent.click(screen.getByRole("button", { name: /create from template/i }));

    await waitFor(() => expect(templates.instantiateTemplate).toHaveBeenCalledWith("gamba", expect.objectContaining({ slug: "g1" })));
  });
});
