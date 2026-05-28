import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectListPage } from "@/pages/ProjectListPage";
import { createProject, listProjects } from "@/services/projects";

vi.mock("@/services/projects", () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
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

  it("creates a project from the empty projects page", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(createProject).mockResolvedValue({
      id: "1",
      name: "Macro Markets",
      slug: "macro-markets",
      description: "Local tracker",
      issueCount: 0,
      workflowStatuses: [],
    });

    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route path="/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("No projects returned by the tracker API.");

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(screen.getByPlaceholderText("Project name"), { target: { value: "Macro Markets" } });
    fireEvent.change(screen.getByPlaceholderText("project-slug"), { target: { value: "macro-markets" } });
    fireEvent.change(screen.getByPlaceholderText("Description"), { target: { value: "Local tracker" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        name: "Macro Markets",
        slug: "macro-markets",
        description: "Local tracker",
      }),
    );

    expect(screen.getByText("Macro Markets")).toBeTruthy();
  });
});
