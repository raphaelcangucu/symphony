import { render, screen } from "@testing-library/react";
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
  }),
}));

vi.mock("@/components/board/BoardPaletteShortcuts", () => ({
  BoardPaletteShortcuts: () => null,
}));

describe("ProjectWorkspaceLayout assistant entry", () => {
  it("renders a route link to the project assistant in workspace chrome", () => {
    render(
      <MemoryRouter initialEntries={["/projects/macro-markets/board"]}>
        <Routes>
          <Route path="/projects/:projectSlug" element={<ProjectWorkspaceLayout />}>
            <Route path="board" element={<div>Board route</div>} />
            <Route path="assistant" element={<div>Assistant route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Assistant/i }).getAttribute("href")).toBe("/projects/macro-markets/assistant");
  });
});
