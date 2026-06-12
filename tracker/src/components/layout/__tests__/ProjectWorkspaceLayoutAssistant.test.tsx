import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ProjectWorkspaceLayout } from "@/components/layout/ProjectWorkspaceLayout";

vi.mock("@/components/layout/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkspace: () => ({
    projectSlug: "macro-markets",
    view: "board",
    trackerKind: "local",
    refetch: vi.fn(),
    refreshing: false,
    issues: [],
  }),
}));

vi.mock("@/components/board/BoardPaletteShortcuts", () => ({
  BoardPaletteShortcuts: () => null,
}));

describe("ProjectWorkspaceLayout assistant entry", () => {
  it("hides board filters on project settings", () => {
    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/settings"]}>
        <Routes>
          <Route path="/projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
            <Route path="settings" element={<div>Settings route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Quick filters")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("exposes the project assistant entry points from workspace chrome", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route path="/projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
            <Route path="board" element={<div>Board route</div>} />
            <Route path="assistant/new-issue" element={<div>Assistant route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Assistant options" }));

    expect((await screen.findByRole("menuitem", { name: "Create issue" })).getAttribute("href")).toBe(
      "/projects/macro-markets/assistant/new-issue",
    );
    expect(screen.getByRole("menuitem", { name: "Explore project" }).getAttribute("href")).toBe(
      "/projects/macro-markets/assistant/explore",
    );
  });
});
