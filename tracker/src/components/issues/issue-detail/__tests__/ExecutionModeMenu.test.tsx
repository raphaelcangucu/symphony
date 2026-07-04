import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";

describe("ExecutionModeMenu", () => {
  it("shows the current mode on the trigger", () => {
    render(<ExecutionModeMenu agent="codex" mode="build" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /build/i })).toBeInTheDocument();
    expect(screen.getByTestId("execution-mode-icon-build")).toBeInTheDocument();
  });

  it("lists every mode for codex and reports the picked one", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ExecutionModeMenu agent="codex" mode="build" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /build/i }));

    expect(screen.getByRole("menuitemradio", { name: /plan/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /yolo/i })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitemradio", { name: /plan/i }));
    expect(onChange).toHaveBeenCalledWith("plan");
  });

  it("hides the plan mode for cursor (no read-only equivalent)", async () => {
    const user = userEvent.setup();
    render(<ExecutionModeMenu agent="cursor" mode="build" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /build/i }));

    expect(screen.queryByRole("menuitemradio", { name: /plan/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /yolo/i })).toBeInTheDocument();
  });
});
