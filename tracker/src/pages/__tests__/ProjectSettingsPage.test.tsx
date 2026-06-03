import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { ProjectSettingsPage } from "@/pages/ProjectSettingsPage";
import * as projects from "@/services/projects";
import * as remote from "@/services/remoteTrackers";
import type { Project } from "@/types/project";

vi.mock("@/services/projects");
vi.mock("@/services/remoteTrackers");

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectSlug/settings" element={<ProjectSettingsPage />} />
        <Route path="/projects/:projectSlug/settings/:tab" element={<ProjectSettingsPage />} />
        <Route path="/projects" element={<div>project list</div>} />
      </Routes>
      <LocationProbe />
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

    renderAt("/projects/macro-markets/settings");

    await waitFor(() => expect(projects.getProject).toHaveBeenCalledWith("macro-markets"));
    expect(await screen.findByRole("tab", { name: /general/i })).toBeInTheDocument();
  });

  it("selects the tab from the URL param", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projects.getProject).mockResolvedValue(project);

    renderAt("/projects/macro-markets/settings/editor");

    expect(await screen.findByRole("tab", { name: /^editor$/i, selected: true })).toBeInTheDocument();
  });

  it("navigates to the tab's own URL when a tab is clicked", async () => {
    vi.mocked(remote.discoverGitHubProjects).mockResolvedValue([]);
    vi.mocked(projects.getProject).mockResolvedValue(project);

    renderAt("/projects/macro-markets/settings");

    await userEvent.click(await screen.findByRole("tab", { name: /^dev$/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/macro-markets/settings/dev"),
    );
    expect(await screen.findByRole("tab", { name: /^dev$/i, selected: true })).toBeInTheDocument();
  });
});
