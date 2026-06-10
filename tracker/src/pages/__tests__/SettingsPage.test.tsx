import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/pages/SettingsPage";
import * as settingsService from "@/services/settings";

vi.mock("@/services/settings", () => ({
  fetchSettings: vi.fn(),
  updateAgentSettings: vi.fn(),
  fetchAgentAvailability: vi.fn(),
  updateOrchestratorSettings: vi.fn(),
  fetchIdentities: vi.fn(),
  fetchCredentials: vi.fn(),
  updateCredential: vi.fn(),
  clearCredential: vi.fn(),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.fetchSettings).mockResolvedValue({
      agents: { default_agent_kind: "codex" },
      orchestrator: { require_symphony_label: true, require_assignee_match: true },
    });
    vi.mocked(settingsService.fetchAgentAvailability).mockResolvedValue({
      codex: { available: true, version: "codex 3.1.0", command: "codex" },
      claude: { available: false, version: null, command: "claude" },
    });
    vi.mocked(settingsService.fetchIdentities).mockResolvedValue([]);
    vi.mocked(settingsService.fetchCredentials).mockResolvedValue([]);
  });

  it("renders the current default and availability", async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /Codex/ })).toBeTruthy());
    expect(screen.getByText(/codex 3\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/not found/i)).toBeTruthy();
  });

  it("saves a new default agent via PUT", async () => {
    vi.mocked(settingsService.updateAgentSettings).mockResolvedValue({ default_agent_kind: "claude" });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /Claude/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Claude/ }));

    await waitFor(() =>
      expect(settingsService.updateAgentSettings).toHaveBeenCalledWith({ default_agent_kind: "claude" }),
    );
  });

  it("reverts optimistic selection when save fails", async () => {
    vi.mocked(settingsService.updateAgentSettings).mockRejectedValue(new Error("network error"));

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /Codex/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Claude/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Codex/ }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByRole("button", { name: /Claude/ }).getAttribute("aria-pressed")).toBe("false");
  });
});
