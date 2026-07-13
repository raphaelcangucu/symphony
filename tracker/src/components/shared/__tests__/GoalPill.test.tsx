import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GoalPill, type GoalPillPhase } from "@/components/shared/GoalPill";
import { initTestI18n } from "@/i18n/testUtils";

function renderGoalPill(
  overrides: Partial<React.ComponentProps<typeof GoalPill>> = {},
) {
  return render(
    <GoalPill
      phase="running"
      provider="codex"
      capabilities={["stop", "pause", "resume", "edit", "clear"]}
      objective="Ship the release"
      running
      timeUsedSeconds={12}
      onStop={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onRemove={vi.fn()}
      onEditObjective={vi.fn()}
      {...overrides}
    />,
  );
}

describe("GoalPill canonical presentation", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders provider badge, objective, canonical label, and stable accessible status", () => {
    renderGoalPill({ running: false });

    expect(screen.getByText("Ship the release")).toBeInTheDocument();
    expect(screen.getByText("Codex native")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Goal" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Pursuing goal. Codex native. Ship the release",
    );
    expect(screen.getByText("12s")).toHaveAttribute("aria-hidden");
  });

  it("keeps a blank objective visible with localized fallback copy", () => {
    renderGoalPill({ objective: "   " });

    expect(screen.getByText("No objective provided.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No objective provided.");
  });

  it.each([
    ["starting", "Starting goal"],
    ["running", "Pursuing goal"],
    ["paused", "Goal paused"],
    ["completed", "Goal completed"],
    ["blocked", "Goal blocked"],
    ["failed", "Goal failed"],
    ["budgetLimited", "Goal budget limit reached"],
    ["usageLimited", "Goal usage limit reached"],
  ] satisfies [GoalPillPhase, string][])(
    "renders the canonical %s label",
    (phase, label) => {
      renderGoalPill({ phase, running: phase === "running" });
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it("shows only controls backed by both capability and handler", () => {
    const onPause = vi.fn();
    const onRemove = vi.fn();
    renderGoalPill({
      capabilities: ["pause", "clear", "edit"],
      onStop: undefined,
      onPause,
      onResume: undefined,
      onRemove,
      onEditObjective: undefined,
    });

    fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove goal" }));

    expect(onPause).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Stop goal process" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit objective" })).not.toBeInTheDocument();
  });

  it("hides objective editing while the goal process is running", () => {
    renderGoalPill({
      running: true,
      capabilities: ["edit"],
      onEditObjective: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: "Edit objective" })).not.toBeInTheDocument();
  });

  it("does not expose controls for an unsupported provider without capabilities", () => {
    renderGoalPill({
      provider: "unsupported",
      capabilities: [],
      onStop: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      onRemove: vi.fn(),
      onEditObjective: vi.fn(),
    });

    expect(screen.getByText("Unsupported provider")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps Stop, Pause, and Remove as distinct controls", () => {
    const onStop = vi.fn();
    const onPause = vi.fn();
    const onRemove = vi.fn();
    renderGoalPill({ onStop, onPause, onRemove });

    fireEvent.click(screen.getByRole("button", { name: "Stop goal process" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove goal" }));

    expect(onStop).toHaveBeenCalledOnce();
    expect(onPause).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("uses a bottom divider without a redundant self-border or top rounding", () => {
    renderGoalPill();

    const banner = screen.getByRole("region", { name: "Goal" });
    expect(banner).toHaveClass("border-b");
    expect(banner.className).not.toContain("rounded-t-xl");
    expect(banner.className).not.toContain("border-b-0");
  });
});
