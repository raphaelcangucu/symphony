import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TurnNavigationRail } from "@/components/assistant/TurnNavigationRail";
import { renderWithI18n } from "@/i18n/testUtils";

describe("TurnNavigationRail", () => {
  it("scrolls to a turn and exposes its preview", async () => {
    const user = userEvent.setup();
    const anchor = document.createElement("div");
    anchor.id = "message-u2";
    anchor.scrollIntoView = vi.fn();
    document.body.append(anchor);

    renderWithI18n(
      <TurnNavigationRail
        items={[
          {
            id: "turn-u2",
            anchorId: "message-u2",
            prompt: "Second prompt",
            responsePreview: "Second response",
          },
        ]}
      />,
    );

    const button = screen.getByRole("button", { name: /go to turn 1/i });
    await user.hover(button);
    expect(screen.getByText("Second prompt")).toBeVisible();
    expect(screen.getByText("Second response")).toBeVisible();
    await user.click(button);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    anchor.remove();
  });
});
