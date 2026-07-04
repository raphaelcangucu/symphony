import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";
import { useProjectSessions } from "@/hooks/useProjectSessions";
import { initTestI18n, renderWithI18n } from "@/i18n/testUtils";
import { emptyProjectSessionGroups } from "@/lib/projectSessions";
import { createProjectSessionThread } from "@/services/assistantThreads";

const projectAssistantPanel = vi.fn((props: { contentMaxWidth?: string }) => (
  <div aria-label="mock assistant panel" data-content-max-width={props.contentMaxWidth} />
));

vi.mock("@/hooks/useProjectSessions", () => ({ useProjectSessions: vi.fn() }));
vi.mock("@/services/assistantThreads", () => ({ createProjectSessionThread: vi.fn() }));
vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: (props: { contentMaxWidth?: string }) => projectAssistantPanel(props),
}));
vi.mock("@/components/layout/WorkspaceContext", () => ({
  useWorkspace: () => ({ projectSlug: "demo", view: "board" }),
}));

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
      isLoading: false,
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

  it("renders a compact sessions header", () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/sessions"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    const header = screen.getByTestId("project-sessions-compact-header");
    expect(header).toHaveClass("py-2");
    expect(within(header).getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByText("Project sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("All assistant chats and agent runs related to this project.")).not.toBeInTheDocument();
  });

  it("opens a new assistant session in a tab", async () => {
    renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/sessions"]}>
        <ProjectSessionsWorkspace projectSlug="demo" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    await waitFor(() => expect(createProjectSessionThread).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: /Planning session/i })).toBeInTheDocument();
    expect(screen.getByLabelText("mock assistant panel")).toBeInTheDocument();
  });

  it("selects an active thread tab from the route", async () => {
    const { container } = renderWithI18n(
      <MemoryRouter initialEntries={["/projects/demo/sessions/42"]}>
        <ProjectSessionsWorkspace projectSlug="demo" activeThreadId={42} />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Project session/i })).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByLabelText("mock assistant panel")).toBeInTheDocument();
    expect(container.querySelector("main > section")).toHaveClass("max-w-[min(100%,96rem)]");
    expect(screen.getByLabelText("mock assistant panel")).toHaveAttribute("data-content-max-width", "wide");
  });
});
