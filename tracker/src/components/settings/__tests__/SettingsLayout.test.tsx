import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SettingsLayout } from "@/components/settings/SettingsLayout";

function renderSettingsLayout(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<div>General content</div>} />
          <Route path="templates" element={<div>Templates content</div>} />
          <Route path="templates/:slug" element={<div>Template edit content</div>} />
          <Route path="backups" element={<div>Backups content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsLayout", () => {
  it("highlights the general section on /settings", async () => {
    renderSettingsLayout("/settings");

    expect(await screen.findByText("General content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "General" }).className).toContain("bg-accent");
    expect(screen.getByRole("link", { name: "Templates" }).className).not.toContain("bg-accent");
  });

  it("highlights templates when editing a template", async () => {
    renderSettingsLayout("/settings/templates/demo");

    expect(await screen.findByText("Template edit content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Templates" }).className).toContain("bg-accent");
    expect(screen.getByRole("link", { name: "General" }).className).not.toContain("bg-accent");
  });

  it("highlights backups on /settings/backups", async () => {
    renderSettingsLayout("/settings/backups");

    expect(await screen.findByText("Backups content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Backups" }).className).toContain("bg-accent");
  });
});
