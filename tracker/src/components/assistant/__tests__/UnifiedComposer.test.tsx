import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UnifiedComposer } from "@/components/assistant/UnifiedComposer";
import { renderWithI18n } from "@/i18n/testUtils";
import { createMockAssistantCatalogBundle } from "@/test-fixtures/assistantCatalog";

const bundle = createMockAssistantCatalogBundle();

function actionHandlers() {
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

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof UnifiedComposer>> = {},
) {
  const callbacks = {
    onSend: vi.fn(),
    onQueue: vi.fn(),
    onSteer: vi.fn(),
    onStop: vi.fn(),
    onPermissionChange: vi.fn(),
  };

  renderWithI18n(
    <UnifiedComposer
      projectSlug="macro-markets"
      bundle={bundle}
      runActive
      pending={false}
      queueingEnabled
      canSteer
      permission="full_access"
      permissionOptions={[
        { id: "ask_for_approval", available: true },
        { id: "approve_for_me", available: true },
        { id: "full_access", available: true },
      ]}
      actionContext={{ hasWorkspace: true, supportsGoal: true }}
      actionHandlers={actionHandlers()}
      {...callbacks}
      {...overrides}
    />,
  );

  return callbacks;
}

describe("UnifiedComposer", () => {
  it("queues Enter during an active run and keeps Stop in the primary slot", async () => {
    const user = userEvent.setup();
    const callbacks = renderComposer();

    await user.type(screen.getByRole("textbox"), "Validate this turn");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(callbacks.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Validate this turn" }),
    );
    expect(callbacks.onSteer).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /stop execution/i }));
    expect(callbacks.onStop).toHaveBeenCalledOnce();
  });

  it("shows the compact add and permission controls", async () => {
    const user = userEvent.setup();
    renderComposer();

    expect(screen.getByRole("button", { name: /full access/i })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("menuitem", { name: /context/i })).toBeVisible();
  });

  it("sends normally when no run is active", () => {
    const callbacks = renderComposer({ runActive: false });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Start the work" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(callbacks.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Start the work" }),
    );
    expect(callbacks.onQueue).not.toHaveBeenCalled();
  });
});
