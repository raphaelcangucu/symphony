import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ComposerPermissionMenu } from "@/components/assistant/ComposerPermissionMenu";
import { renderWithI18n } from "@/i18n/testUtils";

describe("ComposerPermissionMenu", () => {
  it("keeps unsupported levels visible and disabled with an explanation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderWithI18n(
      <ComposerPermissionMenu
        value="full_access"
        options={[
          { id: "ask_for_approval", available: true },
          {
            id: "approve_for_me",
            available: false,
            unavailableReason: "Unavailable for this agent",
          },
          { id: "full_access", available: true },
        ]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /full access/i }));

    expect(
      screen.getByRole("menuitemradio", { name: /approve for me/i }),
    ).toHaveAttribute("data-disabled");
    expect(screen.getByText("Unavailable for this agent")).toBeVisible();

    await user.click(
      screen.getByRole("menuitemradio", { name: /ask for approval/i }),
    );
    expect(onChange).toHaveBeenCalledWith("ask_for_approval");
  });
});
