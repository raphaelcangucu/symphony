import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ProjectWorkspaceWizard } from "@/components/projects/ProjectWorkspaceWizard";
import * as templates from "@/services/templates";
import * as projectSetup from "@/services/projectSetup";

vi.mock("@/services/templates");
vi.mock("@/services/projectSetup");

describe("ProjectWorkspaceWizard create redirect", () => {
  afterEach(() => vi.clearAllMocks());

  it("redirects to the new project's settings page after creating from a template", async () => {
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([]);
    vi.mocked(templates.listTemplates).mockResolvedValue([
      {
        id: "t1",
        slug: "macro",
        name: "Macro",
        description: null,
        validationCommands: [],
        workflowStatuses: [],
        afterCreateHook: null,
        promptTemplate: null,
        devEnvMarkdown: null,
        metadata: {},
        repositories: [],
      },
    ]);
    vi.mocked(templates.instantiateTemplate).mockResolvedValue({
      id: "9",
      slug: "macro-markets",
      name: "Macro Markets",
      description: null,
      tracker: { kind: "local", config: {} },
    });

    render(
      <MemoryRouter initialEntries={["/projects/new"]}>
        <Routes>
          <Route path="/projects/new" element={<ProjectWorkspaceWizard open onOpenChange={vi.fn()} />} />
          <Route path="/projects/:projectSlug/settings" element={<div>settings for macro-markets</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText("Macro"));
    await userEvent.type(screen.getByPlaceholderText("Project name"), "Macro Markets");
    await userEvent.type(screen.getByPlaceholderText("project-slug"), "macro-markets");
    await userEvent.click(screen.getByRole("button", { name: /create from template/i }));

    await waitFor(() => expect(screen.getByText("settings for macro-markets")).toBeInTheDocument());
  });
});
