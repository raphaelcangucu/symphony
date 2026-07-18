import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FloatingSurfaceHost } from "@/components/floating/FloatingSurfaceHost";
import { initTestI18n } from "@/i18n/testUtils";
import {
  openFloatingSurface,
  resetFloatingSurfaceStoreForTests,
} from "@/stores/floatingSurfaceStore";

vi.mock("@/components/terminal/ProjectTerminalWorkspace", () => ({
  ProjectTerminalWorkspace: () => <div>Project terminal</div>,
}));

vi.mock("@/components/terminal/TerminalWorkspacePanel", () => ({
  TerminalWorkspacePanel: () => <div>Issue terminal</div>,
}));

vi.mock("@/components/terminal/TerminalView", () => ({
  TerminalView: () => <div>Dev server output</div>,
}));

afterEach(() => {
  resetFloatingSurfaceStoreForTests();
});

describe("FloatingSurfaceHost", () => {
  it("keeps an open surface mounted across route changes", async () => {
    await initTestI18n();
    const user = userEvent.setup();
    openFloatingSurface({
      kind: "project-terminal",
      projectSlug: "acme",
      tabId: "shell",
      title: "Project shell",
    });

    render(
      <MemoryRouter initialEntries={["/a"]}>
        <FloatingSurfaceHost />
        <Routes>
          <Route
            path="/a"
            element={
              <div>
                Page A
                <Link to="/b">Go to B</Link>
              </div>
            }
          />
          <Route path="/b" element={<div>Page B</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("floating-surface")).toBeInTheDocument();
    expect(screen.getByText("Project shell")).toBeInTheDocument();
    expect(screen.getByText("Page A")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Go to B" }));

    expect(screen.getByText("Page B")).toBeInTheDocument();
    expect(screen.getByTestId("floating-surface")).toBeInTheDocument();
    expect(screen.getByText("Project shell")).toBeInTheDocument();
  });
});
