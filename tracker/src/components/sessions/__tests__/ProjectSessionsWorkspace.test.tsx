import { fireEvent, screen, waitFor } from "@testing-library/react";
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
import { createProjectSessionThread } from "@/services/assistantThreads";

const projectAssistantPanel = vi.fn((props: { contentMaxWidth?: string }) => (
  <div aria-label="mock assistant panel" data-content-max-width={props.contentMaxWidth} />
));

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({
  createProjectSessionThread: vi.fn(),
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
      {chromeState ? (
        <div>
          <span data-testid="sessions-chrome-count">{chromeState.count}</span>
          <button type="button" onClick={chromeState.onCreateSession} disabled={chromeState.isCreating}>
            {chromeState.isCreating ? "Creating..." : "New session"}
          </button>
        </div>
      ) : null}
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
    vi.mocked(createProjectSessionThread).mockResolvedValue({
      id: 42,
      scope: "project_session",
      agentKind: null,
      projectSlug: "demo",
      projectName: "Demo",
      issueIdentifier: null,
      title: "Planning session",
      status: "active",
      preview: null,
      updatedAt: "2026-07-03T00:00:00Z",
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

  it("opens a new assistant session in a tab", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/workspaces"]}>
        <SessionsChromeHarness>
          <ProjectSessionsWorkspace projectSlug="demo" />
        </SessionsChromeHarness>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "New session" }));

    await waitFor(() => expect(createProjectSessionThread).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: /Planning session/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock assistant panel")).toBeInTheDocument();
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
