import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GitDiffLauncher } from "../GitDiffLauncher";

vi.mock("../GitDiffModal", () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <div role="dialog">
        diff-modal
        <button type="button" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

describe("GitDiffLauncher", () => {
  it("opens the modal from the toolbar button", async () => {
    const user = userEvent.setup();
    render(<GitDiffLauncher projectSlug="advising" identifier="CDE-1" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /diff/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens on Ctrl+G when not typing into an input", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Composer" />
        <GitDiffLauncher projectSlug="advising" identifier="CDE-1" />
      </>,
    );

    await user.click(screen.getByLabelText("Composer"));
    await user.keyboard("{Control>}g{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.tab();
    await user.keyboard("{Control>}g{/Control}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
