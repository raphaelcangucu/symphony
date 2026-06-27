import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSwitcher } from "@/components/layout/ProjectSwitcher";
import { listProjects } from "@/services/projects";
import type { Project } from "@/types/project";

vi.mock("@/services/projects", () => ({
  listProjects: vi.fn(),
}));

function makeProject(slug: string, name: string): Project {
  return {
    id: slug,
    slug,
    name,
    description: null,
    tracker: { kind: "local", config: {} },
    archivedAt: null,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderSwitcher(initialPath: string, projectSlug: string, title?: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ProjectSwitcher projectSlug={projectSlug} title={title} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("ProjectSwitcher", () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockReset();
  });

  it("lists the available projects when opened", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([makeProject("gamba", "Gamba"), makeProject("other", "Other")]);

    renderSwitcher("/projects/gamba/kb", "gamba", "Gamba");
    await user.click(screen.getByRole("button", { name: "Switch project" }));

    expect(await screen.findByText("Other")).toBeInTheDocument();
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it("keeps the current workspace section when switching projects", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([makeProject("gamba", "Gamba"), makeProject("other", "Other")]);

    renderSwitcher("/projects/gamba/kb/repo/some-page", "gamba", "Gamba");
    await user.click(screen.getByRole("button", { name: "Switch project" }));
    await user.click(await screen.findByText("Other"));

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/other/kb");
  });

  it("falls back to the board section for unknown sections", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([makeProject("gamba", "Gamba"), makeProject("other", "Other")]);

    renderSwitcher("/projects/gamba", "gamba", "Gamba");
    await user.click(screen.getByRole("button", { name: "Switch project" }));
    await user.click(await screen.findByText("Other"));

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/other/board");
  });

  it("does not navigate when selecting the active project", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([makeProject("gamba", "Gamba"), makeProject("other", "Other")]);

    renderSwitcher("/projects/gamba/list", "gamba", "Gamba");
    await user.click(screen.getByRole("button", { name: "Switch project" }));
    await user.click(await screen.findByRole("menuitem", { name: /Gamba/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/gamba/list");
  });

  it("still shows the current project when the list request fails", async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockRejectedValue(new Error("offline"));

    renderSwitcher("/projects/gamba/board", "gamba", "Gamba");
    await user.click(screen.getByRole("button", { name: "Switch project" }));

    expect(await screen.findByRole("menuitem", { name: /Gamba/ })).toBeInTheDocument();
  });
});
