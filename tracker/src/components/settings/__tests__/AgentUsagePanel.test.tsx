import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentUsagePanel } from "@/components/settings/AgentUsagePanel";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import * as service from "@/services/agentUsage";
import type { AgentUsageMap } from "@/types/agent-usage";

const usageMap: AgentUsageMap = {
  codex: {
    agentKind: "codex",
    plan: "max",
    creditsRemaining: 5,
    creditsUnlimited: false,
    fetchedAt: 1_900_000_000,
    stale: false,
    windows: [
      { kind: "session", usedPercent: 42, resetsAt: 1_900_000_000, windowMinutes: 300 },
      { kind: "weekly", usedPercent: 8, resetsAt: 1_900_500_000, windowMinutes: 10_080 },
    ],
    modelLimits: [],
  },
  claude: null,
  cursor: null,
};

describe("AgentUsagePanel", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders per-agent windows and an unavailable message for agents without usage", async () => {
    vi.spyOn(service, "getAgentUsage").mockResolvedValue(usageMap);

    renderWithI18n(<AgentUsagePanel />);

    await waitFor(() => expect(screen.getByText("Session")).toBeInTheDocument());
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Plan: max")).toBeInTheDocument();
    expect(screen.getAllByText("Usage unavailable for this agent.").length).toBeGreaterThanOrEqual(2);
  });

  it("refetches when the refresh button is clicked", async () => {
    const spy = vi.spyOn(service, "getAgentUsage").mockResolvedValue(usageMap);

    renderWithI18n(<AgentUsagePanel />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: /Refresh/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
