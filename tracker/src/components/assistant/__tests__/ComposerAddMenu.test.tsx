import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ComposerAddMenu } from "@/components/assistant/ComposerAddMenu";
import { renderWithI18n } from "@/i18n/testUtils";

function handlers() {
  return {
    files: vi.fn(),
    context: vi.fn(),
    diff: vi.fn(),
    kb: vi.fn(),
    magic: vi.fn(),
    goal: vi.fn(),
    commands: vi.fn(),
  };
}

describe("ComposerAddMenu", () => {
  it("shows the complete compact action registry and invokes actions", async () => {
    const user = userEvent.setup();
    const onAction = handlers();

    renderWithI18n(
      <ComposerAddMenu
        context={{ hasWorkspace: true, supportsGoal: true }}
        handlers={onAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add/i }));

    for (const label of [
      "Files and folders",
      "Context",
      "Diff",
      "Knowledge Base",
      "Magic",
      "Goal",
      "Commands and skills",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeVisible();
    }

    await user.click(screen.getByRole("menuitem", { name: "Magic" }));
    expect(onAction.magic).toHaveBeenCalledOnce();
  });

  it("omits structurally irrelevant diff and disables unsupported goal", async () => {
    const user = userEvent.setup();

    renderWithI18n(
      <ComposerAddMenu
        context={{ hasWorkspace: false, supportsGoal: false }}
        handlers={handlers()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(screen.queryByRole("menuitem", { name: "Diff" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Goal" })).toHaveAttribute(
      "data-disabled",
    );
  });
});
