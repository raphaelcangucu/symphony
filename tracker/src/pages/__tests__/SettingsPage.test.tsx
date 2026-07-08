import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import { SettingsPage } from "@/pages/SettingsPage";
import * as settingsService from "@/services/settings";

vi.mock("@/services/settings", () => ({
  fetchSettings: vi.fn(),
  updateAgentSettings: vi.fn(),
  updateUiSettings: vi.fn(),
  fetchAgentAvailability: vi.fn(),
  updateOrchestratorSettings: vi.fn(),
  fetchIdentities: vi.fn(),
  fetchCredentials: vi.fn(),
  updateCredential: vi.fn(),
  clearCredential: vi.fn(),
}));

vi.mock("@/services/agentUsage", () => ({
  getAgentUsage: vi.fn().mockResolvedValue({ codex: null, claude: null, cursor: null, opencode: null }),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.fetchSettings).mockResolvedValue({
      agents: { default_agent_kind: "codex" },
      lab: { bundle_child_orchestration: false },
      orchestrator: {
        require_symphony_label: true,
        require_assignee_match: true,
        agent_token_budget_enabled: false,
        agent_token_budget: 4_000_000,
      },
      ui: { locale: "auto" },
    });
    vi.mocked(settingsService.fetchAgentAvailability).mockResolvedValue({
      codex: { available: true, version: "codex 3.1.0", command: "codex" },
      claude: { available: false, version: null, command: "claude" },
      cursor: { available: false, version: null, command: "cursor-agent" },
      opencode: { available: false, version: null, command: "opencode" },
    });
    vi.mocked(settingsService.fetchIdentities).mockResolvedValue([]);
    vi.mocked(settingsService.fetchCredentials).mockResolvedValue([]);
  });

  function renderPage() {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it("renders the current default and availability", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Codex/ })).toBeTruthy());
    expect(screen.getByText(/codex 3\.1\.0/)).toBeTruthy();
    expect(screen.getAllByText(/not found/i)).toHaveLength(3);
  });

  it("saves a new default agent via PUT", async () => {
    vi.mocked(settingsService.updateAgentSettings).mockResolvedValue({ default_agent_kind: "claude" });

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Claude/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Claude/ }));

    await waitFor(() =>
      expect(settingsService.updateAgentSettings).toHaveBeenCalledWith({ default_agent_kind: "claude" }),
    );
  });

  it("reverts optimistic selection when save fails", async () => {
    vi.mocked(settingsService.updateAgentSettings).mockRejectedValue(new Error("network error"));

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Codex/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Claude/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Codex/ }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByRole("button", { name: /Claude/ }).getAttribute("aria-pressed")).toBe("false");
  });
});
