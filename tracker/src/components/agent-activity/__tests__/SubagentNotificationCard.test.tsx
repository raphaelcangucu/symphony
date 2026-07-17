import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubagentNotificationCard } from "@/components/agent-activity/SubagentNotificationCard";
import { SubagentDrawerContext } from "@/components/agent-activity/subagentDrawerContext";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import type { SubagentNotification } from "@/lib/subagentNotification";

const NOTIFICATION: SubagentNotification = {
  agentId: "019f7186-95e7-7a91-ac42-e918d56f7b06",
  headline: "CHANGES_REQUESTED",
  tone: "warning",
  detail: "**Findings**\n- note",
};

describe("SubagentNotificationCard", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders the headline badge", () => {
    renderWithI18n(<SubagentNotificationCard notification={NOTIFICATION} />);

    expect(screen.getByTestId("subagent-notification-headline").textContent).toBe(
      "CHANGES_REQUESTED",
    );
    expect(screen.getByText("Subagent report")).toBeTruthy();
  });

  it("hides the view-activity button without a drawer provider", () => {
    renderWithI18n(<SubagentNotificationCard notification={NOTIFICATION} />);
    expect(screen.queryByTestId("subagent-notification-view-activity")).toBeNull();
  });

  it("hides the view-activity button when agentId is null", () => {
    const openSubagent = vi.fn();
    renderWithI18n(
      <SubagentDrawerContext.Provider value={{ openSubagent, agentKind: "codex" }}>
        <SubagentNotificationCard notification={{ ...NOTIFICATION, agentId: null }} />
      </SubagentDrawerContext.Provider>,
    );

    expect(screen.queryByTestId("subagent-notification-view-activity")).toBeNull();
    expect(openSubagent).not.toHaveBeenCalled();
  });

  it("calls openSubagent with { resolve: id, id } when the button is clicked", () => {
    const openSubagent = vi.fn();
    renderWithI18n(
      <SubagentDrawerContext.Provider value={{ openSubagent, agentKind: "codex" }}>
        <SubagentNotificationCard notification={NOTIFICATION} />
      </SubagentDrawerContext.Provider>,
    );

    fireEvent.click(screen.getByTestId("subagent-notification-view-activity"));
    expect(openSubagent).toHaveBeenCalledTimes(1);
    expect(openSubagent).toHaveBeenCalledWith({
      resolve: "id",
      id: "019f7186-95e7-7a91-ac42-e918d56f7b06",
    });
  });
});
