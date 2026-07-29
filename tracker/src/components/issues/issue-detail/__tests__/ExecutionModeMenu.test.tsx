import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";

describe("ExecutionModeMenu", () => {
  it("shows the provider-neutral permission on the trigger", () => {
    render(<ExecutionModeMenu agent="codex" mode="build" onChange={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /approve for me/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("execution-mode-icon-build")).toBeInTheDocument();
  });

  it("lists every mode for codex and reports the picked one", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ExecutionModeMenu agent="codex" mode="build" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /approve for me/i }));

    expect(
      screen.getByRole("menuitemradio", { name: /ask for approval/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: /full access/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("menuitemradio", { name: /ask for approval/i }),
    );
    expect(onChange).toHaveBeenCalledWith("plan");
  });

  it("lists plan mode for cursor", async () => {
    const user = userEvent.setup();
    render(<ExecutionModeMenu agent="cursor" mode="build" onChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /approve for me/i }));

    expect(
      screen.getByRole("menuitemradio", { name: /ask for approval/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: /full access/i }),
    ).toBeInTheDocument();
  });
});
