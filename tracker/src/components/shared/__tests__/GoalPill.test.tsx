import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GoalPill } from "@/components/shared/GoalPill";
import { initTestI18n } from "@/i18n/testUtils";

function renderGoalPill() {
  return render(
    <GoalPill
      phase="running"
      objective="Ship the release"
      running
      timeUsedSeconds={12}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onRemove={vi.fn()}
      onEditObjective={vi.fn()}
    />,
  );
}

describe("GoalPill", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders the objective and phase label", () => {
    renderGoalPill();

    expect(screen.getByText("Ship the release")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // Regression: the pill is always docked inside the composer's
  // `overflow-hidden rounded-2xl border` card, so drawing its own full border with
  // a mismatched `rounded-t-xl` radius produced a visible double border. It must be
  // a plain in-card header divider (bottom border only) instead.
  it("uses a bottom divider without a redundant self-border or top rounding", () => {
    renderGoalPill();

    const banner = screen.getByRole("status");
    expect(banner).toHaveClass("border-b");
    expect(banner.className).not.toContain("rounded-t-xl");
    expect(banner.className).not.toContain("border-b-0");
  });
});
