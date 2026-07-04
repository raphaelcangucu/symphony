import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import { AgentToolSettingsPage } from "@/pages/AgentToolSettingsPage";
import * as settingsService from "@/services/settings";
import type { AgentTool } from "@/services/settings";

vi.mock("@/services/settings", () => ({
  fetchAgentTools: vi.fn(),
  updateAgentModel: vi.fn(),
}));

function codexTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    id: "codex",
    kind: "codex",
    status: { installed: true, version: "codex-cli 0.142.3", path: "/usr/local/bin/codex", command: "codex" },
    source: { value: "path", managed: false, detail: "/usr/local/bin/codex" },
    install: { available: false, command: null },
    model: { options: ["gpt-5-codex", "gpt-5"], selected: "gpt-5" },
    ...overrides,
  };
}

function renderAgentPage(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/agents/:agent" element={<AgentToolSettingsPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("AgentToolSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.fetchAgentTools).mockResolvedValue([codexTool()]);
  });

  it("renders status, source, and the selected model for a supported agent", async () => {
    renderAgentPage("/settings/agents/codex");

    expect(await screen.findByText(/codex-cli 0\.142\.3/)).toBeTruthy();
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0);

    const select = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect(select.value).toBe("gpt-5");
  });

  it("persists a model change via updateAgentModel", async () => {
    vi.mocked(settingsService.updateAgentModel).mockResolvedValue({ codex: "gpt-5-codex" });
    renderAgentPage("/settings/agents/codex");

    const select = await screen.findByRole("combobox", { name: "Model" });
    fireEvent.change(select, { target: { value: "gpt-5-codex" } });

    await waitFor(() =>
      expect(settingsService.updateAgentModel).toHaveBeenCalledWith("codex", "gpt-5-codex"),
    );
  });

  it("clearing the model sends null (CLI default)", async () => {
    vi.mocked(settingsService.updateAgentModel).mockResolvedValue({ codex: null });
    renderAgentPage("/settings/agents/codex");

    const select = await screen.findByRole("combobox", { name: "Model" });
    fireEvent.change(select, { target: { value: "" } });

    await waitFor(() => expect(settingsService.updateAgentModel).toHaveBeenCalledWith("codex", null));
  });

  it("shows an unsupported notice for agents Symphony cannot run", async () => {
    renderAgentPage("/settings/agents/grok");

    expect(await screen.findByText(/Symphony can't run Grok yet/)).toBeTruthy();
    expect(screen.getAllByText("Not installed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(settingsService.fetchAgentTools).not.toHaveBeenCalled();
  });
});
