import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkingIndicator } from "../WorkingIndicator";

describe("WorkingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  it("exposes a polite live region for assistive tech", () => {
    render(<WorkingIndicator startedAt={Date.now()} activeTool={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
