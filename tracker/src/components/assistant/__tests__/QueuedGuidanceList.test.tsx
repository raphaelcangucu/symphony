import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QueuedGuidanceList } from "@/components/assistant/QueuedGuidanceList";
import { renderWithI18n } from "@/i18n/testUtils";

const item = {
  id: "queued-1",
  message: "Validate the compact composer",
  error: null,
};

function handlers() {
  return {
    onPromote: vi.fn(),
    onResend: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onOpenSideChat: vi.fn(),
    onQueueingEnabledChange: vi.fn(),
  };
}

describe("QueuedGuidanceList", () => {
  it("promotes a queued item when steer is available", async () => {
    const user = userEvent.setup();
    const callbacks = handlers();

    renderWithI18n(
      <QueuedGuidanceList
        items={[item]}
        canSteer
        queueingEnabled
        {...callbacks}
      />,
    );

    await user.click(screen.getByRole("button", { name: /steer now/i }));
    expect(callbacks.onPromote).toHaveBeenCalledWith("queued-1");
    expect(callbacks.onResend).not.toHaveBeenCalled();
  });

  it("offers resend without claiming steer support", async () => {
    const user = userEvent.setup();
    const callbacks = handlers();

    renderWithI18n(
      <QueuedGuidanceList
        items={[item]}
        canSteer={false}
        queueingEnabled
        {...callbacks}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /steer now/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send again/i }));
    expect(callbacks.onResend).toHaveBeenCalledWith("queued-1");
  });

  it("keeps edit, side chat, queue toggle, and remove available", async () => {
    const user = userEvent.setup();
    const callbacks = handlers();

    renderWithI18n(
      <QueuedGuidanceList
        items={[item]}
        canSteer
        queueingEnabled
        {...callbacks}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /more options for queued guidance/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /edit message/i }));
    expect(callbacks.onEdit).toHaveBeenCalledWith("queued-1");

    await user.click(
      screen.getByRole("button", { name: /more options for queued guidance/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /open in side chat/i }));
    expect(callbacks.onOpenSideChat).toHaveBeenCalledWith("queued-1");

    await user.click(
      screen.getByRole("button", { name: /more options for queued guidance/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /turn off queueing/i }));
    expect(callbacks.onQueueingEnabledChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: /remove queued guidance/i }));
    expect(callbacks.onRemove).toHaveBeenCalledWith("queued-1");
  });

  it("renders a retained promotion error inline", () => {
    renderWithI18n(
      <QueuedGuidanceList
        items={[{ ...item, error: "The active turn cannot be steered." }]}
        canSteer
        queueingEnabled
        {...handlers()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The active turn cannot be steered.",
    );
    expect(screen.getByText(item.message)).toBeVisible();
  });
});
