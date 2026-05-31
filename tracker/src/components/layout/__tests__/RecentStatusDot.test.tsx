import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";

describe("RecentStatusDot", () => {
  it("renders an accessible label for the status", () => {
    const { getByLabelText } = render(<RecentStatusDot statusKind="running" />);
    expect(getByLabelText(/running/i)).toBeInTheDocument();
  });

  it("applies a pulse animation for active running state", () => {
    const { getByLabelText } = render(<RecentStatusDot statusKind="running" />);
    expect(getByLabelText(/running/i).className).toMatch(/animate-pulse/);
  });

  it("renders without pulse for a terminal state", () => {
    const { getByLabelText } = render(<RecentStatusDot statusKind="done" />);
    expect(getByLabelText(/done/i).className).not.toMatch(/animate-pulse/);
  });
});
