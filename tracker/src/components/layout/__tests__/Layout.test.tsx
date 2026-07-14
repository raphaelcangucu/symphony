import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Layout } from "@/components/layout/Layout";

vi.mock("@/components/layout/ProjectSidebar", () => ({
  ProjectSidebar: () => <aside aria-label="Project sidebar" />,
}));

vi.mock("@/components/layout/sidebar/SidebarMobileDrawer", () => ({
  SidebarMobileDrawer: () => null,
}));

vi.mock("@/components/layout/sidebar/SidebarTreeContext", () => ({
  SidebarTreeProvider: ({ children }: { children: ReactNode }) => children,
}));

describe("Layout", () => {
  it("contains the viewport shell overflow", () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    );

    const sidebar = screen.getByRole("complementary", { name: "Project sidebar" });
    expect(sidebar.parentElement).toHaveClass("h-screen", "min-h-0", "overflow-hidden");
  });
});
