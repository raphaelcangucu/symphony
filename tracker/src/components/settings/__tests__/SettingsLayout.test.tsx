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
          <Route path="appearance" element={<div>Appearance content</div>} />
          <Route path="agents/:agent" element={<div>Agent content</div>} />
          <Route path="providers" element={<div>Providers content</div>} />
          <Route path="usage" element={<div>Usage content</div>} />
          <Route path="experimental" element={<div>Experimental content</div>} />
          <Route path="templates" element={<div>Templates content</div>} />
          <Route path="templates/:slug" element={<div>Template edit content</div>} />
          <Route path="backups" element={<div>Backups content</div>} />
          <Route path="gateways" element={<div>Gateways content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsLayout", () => {
  it("renders grouped navigation headers", async () => {
    renderSettingsLayout("/settings");

    expect(await screen.findByText("General content")).toBeTruthy();
    expect(screen.getByText("Agents")).toBeTruthy();
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText("Insights")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Docker" })).toHaveAttribute(
      "href",
      "/settings/docker",
    );
  });

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

  it("highlights a supported agent page", async () => {
    renderSettingsLayout("/settings/agents/codex");

    expect(await screen.findByText("Agent content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Codex" }).className).toContain("bg-accent");
  });

  it("highlights providers on /settings/providers", async () => {
    renderSettingsLayout("/settings/providers");

    expect(await screen.findByText("Providers content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Providers" }).className).toContain("bg-accent");
  });

  it("highlights usage on /settings/usage", async () => {
    renderSettingsLayout("/settings/usage");

    expect(await screen.findByText("Usage content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Usage" }).className).toContain("bg-accent");
  });

  it("highlights experimental on /settings/experimental", async () => {
    renderSettingsLayout("/settings/experimental");

    expect(await screen.findByText("Experimental content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Experimental" }).className).toContain("bg-accent");
  });

  it("highlights gateways on /settings/gateways", async () => {
    renderSettingsLayout("/settings/gateways");

    expect(await screen.findByText("Gateways content")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Gateways" }).className).toContain("bg-accent");
  });
});
