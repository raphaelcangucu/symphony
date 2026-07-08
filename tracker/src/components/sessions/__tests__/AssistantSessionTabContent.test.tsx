import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantSessionTabContent } from "@/components/sessions/AssistantSessionTabContent";
import { initTestI18n } from "@/i18n/testUtils";

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: () => <div data-testid="assistant-panel" />,
}));

vi.mock("@/hooks/useIssueEditor", () => ({
  useIssueEditor: () => ({
    browser: { available: true, url: "https://code.example/510", reason: null },
    cursorDesktop: { available: false, url: null, reason: "workspace_missing" },
    loading: false,
  }),
}));

const listAssistantThreadsMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/assistantThreads", () => ({
  listAssistantThreads: (...args: unknown[]) => listAssistantThreadsMock(...args),
}));

describe("AssistantSessionTabContent", () => {
  beforeEach(async () => {
    await initTestI18n("en");
    listAssistantThreadsMock.mockReset();
    listAssistantThreadsMock.mockResolvedValue([
      {
        id: 7996,
        scope: "issue_session",
        agentKind: "codex",
        projectSlug: "macro-markets",
        projectName: "Macro Markets",
        issueIdentifier: "510",
        title: "Build pass",
        status: "active",
        preview: null,
        updatedAt: "2026-07-07T00:00:00Z",
      },
    ]);
  });

  it("shows issue working-tree actions for issue-bound assistant sessions", async () => {
    render(
      <MemoryRouter>
        <AssistantSessionTabContent projectSlug="macro-markets" threadId={7996} view="board" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "Open issue 510" })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/510/sessions",
    );
    expect(screen.getByRole("link", { name: "Terminal for 510" })).toHaveAttribute(
      "href",
      "/projects/macro-markets/board/issues/510/terminal",
    );
    expect(screen.getByRole("button", { name: /open in code/i })).toBeInTheDocument();
    expect(screen.getByTestId("assistant-panel")).toBeInTheDocument();
  });
});
