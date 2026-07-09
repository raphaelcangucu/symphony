import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkingIndicator } from "../WorkingIndicator";
import { initTestI18n } from "@/i18n/testUtils";

describe("WorkingIndicator", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await initTestI18n("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an elapsed timer starting at 0:00", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool={null} />);
    expect(screen.getByText(/0:00/)).toBeInTheDocument();
  });

  it("increments the elapsed timer every second", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool={null} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/0:03/)).toBeInTheDocument();
  });

  it("shows the active tool name when a tool is running", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool="update_issue" />);
    expect(screen.getByText(/Running update_issue/)).toBeInTheDocument();
  });

  it("shows command summary when activeToolDetail is set", () => {
    const onStop = vi.fn();
    const onKill = vi.fn();
    render(
      <WorkingIndicator
        startedAt={Date.now()}
        activeToolDetail={{ name: "Bash", argumentsSummary: "pest --parallel --shard=3/3", id: "t1" }}
        onStop={onStop}
        onKill={onKill}
      />,
    );
    expect(screen.getByText(/pest --parallel/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    fireEvent.click(screen.getByRole("button", { name: /kill/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onKill).toHaveBeenCalledWith("t1");
  });

  it("shows a stale hint when stale is true", () => {
    render(
      <WorkingIndicator
        startedAt={Date.now()}
        activeToolDetail={{ name: "Bash", argumentsSummary: "sleep 1", id: "t1" }}
        stale
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText(/No updates/)).toBeInTheDocument();
  });

  it("exposes a polite live region for assistive tech", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
