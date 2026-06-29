import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { UsageWindowBar } from "@/components/settings/UsageWindowBar";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { UsageWindow } from "@/types/agent-usage";

describe("UsageWindowBar", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders a labeled progress bar at the clamped percent", () => {
    const usageWindow: UsageWindow = {
      kind: "session",
      usedPercent: 130,
      resetsAt: null,
      windowMinutes: 300,
    };

    renderWithI18n(<UsageWindowBar label="Session" usageWindow={usageWindow} />);

    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders a resets line when resetsAt is set", () => {
    const usageWindow: UsageWindow = {
      kind: "weekly",
      usedPercent: 20,
      resetsAt: 1_900_000_000,
      windowMinutes: 10_080,
    };

    renderWithI18n(<UsageWindowBar label="Weekly" usageWindow={usageWindow} />);
    expect(screen.getByText(/Resets/)).toBeInTheDocument();
  });

  it("renders nothing when the window is null", () => {
    const { container } = renderWithI18n(<UsageWindowBar label="Session" usageWindow={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
