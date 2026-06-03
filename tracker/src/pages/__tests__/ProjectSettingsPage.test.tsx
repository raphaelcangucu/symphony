import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import type { Project } from "@/types/project";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${slug}/settings`]}>
      <Routes>
        <Route path="/projects/:projectSlug/settings" element={<ProjectSettingsPage />} />
        <Route path="/projects" element={<div>project list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const project: Project = {
  id: "3",
  slug: "macro-markets",
  name: "Macro Markets",
  description: null,
  tracker: { kind: "local", config: {} },
  workflowStatuses: [],
  setup: { validationCommands: [], workflowConfig: {} },
};

describe("ProjectSettingsPage", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads the project and renders the config editor", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projects.getProject).mockResolvedValue(project);

    renderAt("macro-markets");

    await waitFor(() => expect(projects.getProject).toHaveBeenCalledWith("macro-markets"));
    expect(await screen.findByRole("tab", { name: /general/i })).toBeInTheDocument();
  });
});
