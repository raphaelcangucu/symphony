import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrchestrationRulesCard } from "@/components/settings/OrchestrationRulesCard";
import * as settingsService from "@/services/settings";

vi.mock("@/services/settings", () => ({
  updateOrchestratorSettings: vi.fn(),
}));

describe("OrchestrationRulesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles a rule and persists the new value via PUT", async () => {
    vi.mocked(settingsService.updateOrchestratorSettings).mockResolvedValue({
      require_symphony_label: false,
      require_assignee_match: true,
      agent_token_budget_enabled: false,
      agent_token_budget: 4_000_000,
    });

    render(
      <OrchestrationRulesCard
        initial={{
          require_symphony_label: true,
          require_assignee_match: true,
          agent_token_budget_enabled: false,
          agent_token_budget: 4_000_000,
        }}
        loadError={false}
      />,
    );

    const labelSwitch = screen.getByRole("switch", { name: /Require a Symphony label/ });
    expect(labelSwitch.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(labelSwitch);

    await waitFor(() =>
      expect(settingsService.updateOrchestratorSettings).toHaveBeenCalledWith({
        require_symphony_label: false,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: /Require a Symphony label/ }).getAttribute("aria-checked"),
      ).toBe("false"),
    );
  });

  it("reverts the toggle when the save fails", async () => {
    vi.mocked(settingsService.updateOrchestratorSettings).mockRejectedValue(new Error("boom"));

    render(
      <OrchestrationRulesCard
        initial={{
          require_symphony_label: true,
          require_assignee_match: true,
          agent_token_budget_enabled: false,
          agent_token_budget: 4_000_000,
        }}
        loadError={false}
      />,
    );

    const labelSwitch = screen.getByRole("switch", { name: /Require a Symphony label/ });
    fireEvent.click(labelSwitch);

    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: /Require a Symphony label/ }).getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });
});
