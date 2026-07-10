import { screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectSessionsChromeSetterContext,
  type ProjectSessionsChromeState,
} from "@/components/layout/ProjectSessionsChromeContext";
import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { emptyProjectSessionGroups } from "@/lib/projectSessions";

const projectAssistantPanel = vi.fn((props: { contentMaxWidth?: string }) => (
  <div aria-label="mock assistant panel" data-content-max-width={props.contentMaxWidth} />
));

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({
  listAssistantThreads: vi.fn(async () => []),
}));
vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: { contentMaxWidth?: string }) => projectAssistantPanel(props),
}));
vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "demo", view: "board" }),
}));

function SessionsChromeHarness({ children }: { children: ReactNode }) {
  const [chromeState, setChromeState] = useState<ProjectSessionsChromeState | null>(null);

  return (
    <ProjectSessionsChromeSetterContext.Provider value={setChromeState}>
      {chromeState ? <span data-testid="sessions-chrome-count">{chromeState.count}</span> : null}
      {children}
    </ProjectSessionsChromeSetterContext.Provider>
  );
}

describe("ProjectSessionsWorkspace", () => {
  const refetch = vi.fn();

  beforeEach(async () => {
    await initTestI18n("en");
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(useProjectSessions).mockReturnValue({
      groups: emptyProjectSessionGroups(),
      relatedSessions: [],
      issues: [],
      executions: new Map(),
      inventory: null,
      isLoading: false,
      isInventoryLoading: false,
      error: null,
      refetch,
    });
  });

  it("omits the duplicate sessions page header", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("project-sessions-compact-header")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Project sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("All assistant chats and agent runs related to this project.")).not.toBeInTheDocument();
  });

  it("publishes the sessions count to the project header chrome", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <SessionsChromeHarness>
          <ProjectSessionsWorkspace projectSlug="demo" />
        </SessionsChromeHarness>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("sessions-chrome-count")).toHaveTextContent("0");
  });

  it("selects an active thread tab from the route", async () => {
    const { container } = renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces/42"]}>
        <ProjectSessionsWorkspace projectSlug="demo" activeThreadId={42} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Project session/i })).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByLabelText("mock assistant panel")).toBeInTheDocument();
    expect(container.querySelector("main > div")).toHaveClass("w-full");
    expect(container.querySelector("main > div")).not.toHaveClass("max-w-[min(100%,96rem)]");
    expect(screen.getByLabelText("mock assistant panel")).toHaveAttribute("data-content-max-width", "wide");
  });
});
