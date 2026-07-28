import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import { AgentToolSettingsPage } from "@/pages/AgentToolSettingsPage";
import * as settingsService from "@/services/settings";
import type { AgentAccount, AgentTool, AllSettings } from "@/services/settings";

vi.mock("@/services/settings", () => ({
  createAgentAccount: vi.fn(),
  deleteAgentAccount: vi.fn(),
  fetchAgentAccounts: vi.fn(),
  fetchAgentTools: vi.fn(),
  fetchSettings: vi.fn(),
  runAgentLifecycle: vi.fn(),
  setDefaultAgentAccount: vi.fn(),
  updateAgentFailover: vi.fn(),
  updateAgentAutoUpdate: vi.fn(),
  updateAgentModel: vi.fn(),
  updateAgentSource: vi.fn(),
}));

function codexTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    id: "codex",
    kind: "codex",
    status: {
      installed: true,
      version: "codex-cli 0.142.3",
      path: "/usr/local/bin/codex",
      command: "codex",
    },
    source: {
      value: "path",
      preferred: "managed",
      managed: false,
      detail: "/usr/local/bin/codex",
      fallback_reason: "managed_missing",
    },
    install: { available: true, strategy: "github_release" },
    model: { options: ["gpt-5-codex", "gpt-5"], selected: "gpt-5" },
    ...overrides,
  };
}

function account(overrides: Partial<AgentAccount> = {}): AgentAccount {
  return {
    id: "personal",
    label: "Personal",
    agent_kind: "codex",
    authentication_status: "authenticated",
    default: true,
    created_at: "2026-07-28T10:00:00Z",
    updated_at: "2026-07-28T10:00:00Z",
    usage: {
      account_id: "personal",
      plan: "Plus",
      credits_remaining: null,
      fetched_at: "2026-07-28T10:00:00Z",
      state: "fresh",
      stale: false,
      stale_reason: null,
      next_refresh_at: null,
      windows: [
        {
          kind: "five_hour",
          used_percent: 20,
          resets_at: null,
          window_minutes: 300,
        },
      ],
    },
    ...overrides,
  };
}

function settings(overrides: Partial<AllSettings> = {}): AllSettings {
  return {
    agents: { default_agent_kind: "codex" },
    agent_cli: {
      codex: {
        preferred_source: "managed",
        auto_update: true,
        failover_enabled: false,
      },
    },
    lab: { bundle_child_orchestration: false },
    orchestrator: {
      require_symphony_label: false,
      require_assignee_match: false,
      agent_token_budget_enabled: false,
      agent_token_budget: 0,
    },
    ui: { locale: "en" },
    ...overrides,
  };
}

function renderAgentPage(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/settings/agents/:agent"
            element={<AgentToolSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("AgentToolSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.fetchAgentTools).mockResolvedValue([codexTool()]);
    vi.mocked(settingsService.fetchAgentAccounts).mockResolvedValue([
      account(),
      account({
        id: "work",
        label: "Work",
        default: false,
        usage: {
          account_id: "work",
          plan: "Team",
          credits_remaining: null,
          fetched_at: "2026-07-28T09:00:00Z",
          state: "stale",
          stale: true,
          stale_reason: "refresh_failed",
          next_refresh_at: "2026-07-28T10:05:00Z",
          windows: [],
        },
      }),
    ]);
    vi.mocked(settingsService.fetchSettings).mockResolvedValue(settings());
    vi.mocked(settingsService.runAgentLifecycle).mockResolvedValue({
      operation: "update",
      status: "installed",
      version: "0.143.0",
      executable_path: "/tmp/agents/codex/versions/0.143.0/codex",
    });
    vi.mocked(settingsService.updateAgentSource).mockResolvedValue({
      preferred_source: "managed",
      auto_update: true,
      failover_enabled: false,
    });
    vi.mocked(settingsService.updateAgentFailover).mockResolvedValue({
      preferred_source: "managed",
      auto_update: true,
      failover_enabled: false,
    });
    vi.mocked(settingsService.updateAgentAutoUpdate).mockResolvedValue({
      preferred_source: "managed",
      auto_update: false,
      failover_enabled: false,
    });
    vi.mocked(settingsService.setDefaultAgentAccount).mockResolvedValue(
      account({ id: "work", label: "Work", default: true }),
    );
  });

  it("renders status, source, and the selected model for a supported agent", async () => {
    renderAgentPage("/settings/agents/codex");

    expect(await screen.findByText(/codex-cli 0\.142\.3/)).toBeTruthy();
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0);

    const select = screen.getByRole("combobox", {
      name: "Model",
    }) as HTMLSelectElement;
    expect(select.value).toBe("gpt-5");
  });

  it("explains when managed resolution falls back to the system PATH", async () => {
    renderAgentPage("/settings/agents/codex");

    expect(
      await screen.findByText(/Managed preferred; using System PATH/),
    ).toBeTruthy();
  });

  it("shows a pending managed update", async () => {
    vi.mocked(settingsService.fetchAgentTools).mockResolvedValue([
      codexTool({
        install: {
          available: true,
          strategy: "github_release",
          pending_version: "0.143.0",
        },
      }),
    ]);
    renderAgentPage("/settings/agents/codex");

    expect(await screen.findByText(/Update 0\.143\.0 pending/)).toBeTruthy();
  });

  it("lets the operator select a default account", async () => {
    renderAgentPage("/settings/agents/codex");

    fireEvent.click(
      await screen.findByRole("button", { name: /Use Work by default/ }),
    );

    await waitFor(() =>
      expect(settingsService.setDefaultAgentAccount).toHaveBeenCalledWith(
        "codex",
        "work",
      ),
    );
  });

  it("keeps automatic failover disabled by default", async () => {
    renderAgentPage("/settings/agents/codex");

    const checkbox = await screen.findByRole("checkbox", {
      name: "Automatic account failover",
    });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("keeps managed CLI updates enabled by default and persists an opt-out", async () => {
    renderAgentPage("/settings/agents/codex");

    const checkbox = await screen.findByRole("checkbox", {
      name: "Automatic CLI updates",
    });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(settingsService.updateAgentAutoUpdate).toHaveBeenCalledWith(
        "codex",
        false,
      ),
    );
  });

  it("marks account usage as stale without hiding the last snapshot", async () => {
    renderAgentPage("/settings/agents/codex");

    expect(await screen.findByText("Team")).toBeTruthy();
    expect(screen.getByText("Stale usage")).toBeTruthy();
  });

  it("surfaces lifecycle action errors", async () => {
    vi.mocked(settingsService.runAgentLifecycle).mockRejectedValue(
      new Error("download failed"),
    );
    renderAgentPage("/settings/agents/codex");

    fireEvent.click(await screen.findByRole("button", { name: "Update CLI" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "download failed",
    );
  });

  it("persists a model change via updateAgentModel", async () => {
    vi.mocked(settingsService.updateAgentModel).mockResolvedValue({
      codex: "gpt-5-codex",
    });
    renderAgentPage("/settings/agents/codex");

    const select = await screen.findByRole("combobox", { name: "Model" });
    fireEvent.change(select, { target: { value: "gpt-5-codex" } });

    await waitFor(() =>
      expect(settingsService.updateAgentModel).toHaveBeenCalledWith(
        "codex",
        "gpt-5-codex",
      ),
    );
  });

  it("clearing the model sends null (CLI default)", async () => {
    vi.mocked(settingsService.updateAgentModel).mockResolvedValue({
      codex: null,
    });
    renderAgentPage("/settings/agents/codex");

    const select = await screen.findByRole("combobox", { name: "Model" });
    fireEvent.change(select, { target: { value: "" } });

    await waitFor(() =>
      expect(settingsService.updateAgentModel).toHaveBeenCalledWith(
        "codex",
        null,
      ),
    );
  });

  it("shows an unsupported notice for agents Symphony cannot run", async () => {
    renderAgentPage("/settings/agents/grok");

    expect(await screen.findByText(/Symphony can't run Grok yet/)).toBeTruthy();
    expect(screen.getAllByText("Not installed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(settingsService.fetchAgentTools).not.toHaveBeenCalled();
    expect(settingsService.fetchAgentAccounts).not.toHaveBeenCalled();
  });
});
