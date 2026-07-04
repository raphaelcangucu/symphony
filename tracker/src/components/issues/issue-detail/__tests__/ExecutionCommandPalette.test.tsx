import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExecutionCommandPalette } from "@/components/issues/issue-detail/ExecutionCommandPalette";
import { isOverlayPaletteActive } from "@/lib/commandPaletteScope";

function renderPalette(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onStop: vi.fn(),
    onHardReset: vi.fn(),
    onCycleMode: vi.fn(),
    onFocusComposer: vi.fn(),
  };
  render(<ExecutionCommandPalette {...handlers} {...overrides} />);
  return handlers;
}

describe("ExecutionCommandPalette", () => {
  it("opens on Cmd+K and lists the execution actions", async () => {
    renderPalette();

    await userEvent.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByText("Resume")).toBeInTheDocument();
    expect(screen.getByText("Restart")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.getByText("Hard reset")).toBeInTheDocument();
    expect(screen.getByText("Cycle execution mode")).toBeInTheDocument();
    expect(screen.getByText("Focus composer")).toBeInTheDocument();
  });

  it("filters actions by typing and runs the selected handler", async () => {
    const handlers = renderPalette();

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(await screen.findByPlaceholderText(/search actions/i), "stop");

    await userEvent.click(await screen.findByText("Stop"));

    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/search actions/i)).not.toBeInTheDocument(),
    );
  });

  it("does not run handlers when disabled", async () => {
    const handlers = renderPalette({ disabled: true });

    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.click(await screen.findByText("Resume"));

    expect(handlers.onResume).not.toHaveBeenCalled();
  });

  it("registers as an overlay palette so the board palette yields ⌘K while mounted", () => {
    expect(isOverlayPaletteActive()).toBe(false);

    const { unmount } = render(<ExecutionCommandPalette onResume={vi.fn()} />);
    expect(isOverlayPaletteActive()).toBe(true);

    unmount();
    expect(isOverlayPaletteActive()).toBe(false);
  });
});
