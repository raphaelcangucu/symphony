import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentFloatingDock } from "@/components/assistant/EnvironmentFloatingDock";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";

describe("EnvironmentFloatingDock", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders diff stats, branch, and icon actions", () => {
    const onCompare = vi.fn();
    const onCommitPush = vi.fn();
    renderWithI18n(
      <EnvironmentFloatingDock
        open
        onClose={vi.fn()}
        additions={12}
        deletions={4}
        branch="feature/assistant-dock"
        sourceLabel="3 documents"
        onCompare={onCompare}
        onCommitPush={onCommitPush}
      />,
    );

    const dock = screen.getByTestId("environment-floating-dock");
    expect(dock).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−4")).toBeInTheDocument();
    expect(screen.getByText("feature/assistant-dock")).toBeInTheDocument();
    expect(screen.getByText("3 documents")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(onCompare).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommitPush).toHaveBeenCalledTimes(1);
  });

  it("returns null when closed", () => {
    renderWithI18n(
      <EnvironmentFloatingDock
        open={false}
        onClose={vi.fn()}
        additions={0}
        deletions={0}
      />,
    );

    expect(screen.queryByTestId("environment-floating-dock")).not.toBeInTheDocument();
  });
});
