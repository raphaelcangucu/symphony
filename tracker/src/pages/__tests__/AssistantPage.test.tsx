import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPage } from "../AssistantPage";
import * as useRecentsModule from "@/hooks/useRecents";
import * as useCreateFreeformChatModule from "@/hooks/useCreateFreeformChat";
import { formatDateTime } from "@/lib/utils";
import { dispatchIssueAgent } from "@/services/issueDispatch";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useRecents");
vi.mock("@/hooks/useCreateFreeformChat");
vi.mock("@/services/issueDispatch", () => ({ dispatchIssueAgent: vi.fn() }));

vi.mock("@/components/assistant/FreeformAssistantPanel", () => ({
  FreeformAssistantPanel: ({ threadId }: { threadId: number }) => (
    <div data-testid="assistant-panel">panel:{threadId}</div>
  ),
}));

const createChat = vi.fn();

function makeSession(overrides: Partial<RecentSession> = {}): RecentSession {
  return {
    id: "chat:1", kind: "chat", scope: "freeform", agentKind: null, projectSlug: null, projectName: null,
    title: "Untitled", identifier: null, threadId: 1, status: "active", statusKind: "active",
    preview: null, updatedAt: "2026-05-30T12:00:00Z", ...overrides,
  };
}

function mockRecents(sessions: RecentSession[], loading = false) {
  vi.mocked(useRecentsModule.useRecents).mockReturnValue({ sessions, loading, refetch: vi.fn() });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/assistant/:threadId" element={<AssistantPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AssistantPage", () => {
  beforeEach(() => {
    createChat.mockClear();
    vi.mocked(dispatchIssueAgent).mockResolvedValue({
      action: "resume",
      message: "Resuming ABC-12",
      issue: {} as never,
    });
    vi.mocked(useCreateFreeformChatModule.useCreateFreeformChat).mockReturnValue({ creating: false, createChat });
    mockRecents([
      makeSession({ id: "chat:7", threadId: 7, title: "Endereços em wallet", preview: "como derivar" }),
      makeSession({ id: "codex:ABC-12", kind: "codex", scope: null, threadId: null, identifier: "ABC-12", title: "Fix login", projectSlug: "app" }),
    ]);
  });

  it("lists chat and execution sessions with type, agent, and date labels", async () => {
    const chatUpdatedAt = "2026-07-02T10:00:00Z";
    const executionUpdatedAt = "2026-07-03T11:00:00Z";
    mockRecents([
      makeSession({
        id: "chat:7",
        threadId: 7,
        title: "Endereços em wallet",
        preview: "como derivar",
        agentKind: "cursor",
        updatedAt: chatUpdatedAt,
      }),
      makeSession({
        id: "codex:ABC-12",
        kind: "codex",
        scope: null,
        threadId: null,
        identifier: "ABC-12",
        title: "Fix login",
        projectSlug: "app",
        projectName: "App",
        agentKind: "codex",
        status: "Aborted",
        statusKind: "aborted",
        updatedAt: executionUpdatedAt,
      }),
    ]);
    renderAt("/assistant");

    expect(await screen.findByRole("link", { name: /Endereços em wallet/ })).toHaveAttribute(
      "href",
      "/assistant/7?assistant_agent=cursor",
    );
    expect(screen.getByRole("link", { name: /Fix login/ })).toHaveAttribute(
      "href",
      "/projects/app/workspaces",
    );
    expect(screen.getByRole("link", { name: "Open issue ABC-12" })).toHaveAttribute(
      "href",
      "/projects/app/board/issues/ABC-12",
    );
    expect(screen.getByRole("img", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Execution" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Cursor" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Codex" })).toBeInTheDocument();
    expect(screen.queryByText("Cursor Agent")).not.toBeInTheDocument();
    expect(screen.getByText(formatDateTime(chatUpdatedAt))).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(executionUpdatedAt))).toBeInTheDocument();
  });

  it("shows resume only for stopped executions and open-issue for every execution", async () => {
    mockRecents([
      makeSession({
        id: "codex:ERR-1",
        kind: "codex",
        scope: null,
        threadId: null,
        identifier: "ERR-1",
        title: "Broken run",
        projectSlug: "app",
        status: "Error",
        statusKind: "error",
      }),
      makeSession({
        id: "codex:RUN-2",
        kind: "codex",
        scope: null,
        threadId: null,
        identifier: "RUN-2",
        title: "Live run",
        projectSlug: "app",
        status: "Running",
        statusKind: "running",
      }),
    ]);
    renderAt("/assistant");

    await screen.findByRole("link", { name: /Broken run/ });
    expect(screen.getByRole("link", { name: "Open issue ERR-1" })).toHaveAttribute(
      "href",
      "/projects/app/board/issues/ERR-1",
    );
    expect(screen.getByRole("link", { name: "Open issue RUN-2" })).toHaveAttribute(
      "href",
      "/projects/app/board/issues/RUN-2",
    );
    expect(screen.getAllByRole("button", { name: /resume/i })).toHaveLength(1);
  });

  it("resumes aborted execution sessions", async () => {
    mockRecents([
      makeSession({
        id: "codex:ABC-12",
        kind: "codex",
        scope: null,
        threadId: null,
        identifier: "ABC-12",
        title: "Fix login",
        projectSlug: "app",
        agentKind: "codex",
        status: "Aborted",
        statusKind: "aborted",
      }),
    ]);
    renderAt("/assistant");

    await userEvent.click(await screen.findByRole("button", { name: /resume/i }));

    await waitFor(() =>
      expect(dispatchIssueAgent).toHaveBeenCalledWith("app", "ABC-12", { action: "resume" }),
    );
  });

  it("filters sessions by the search query", async () => {
    mockRecents([
      makeSession({ id: "chat:7", threadId: 7, title: "Endereços em wallet", preview: "como derivar" }),
      makeSession({ id: "chat:8", threadId: 8, title: "Plano de testes", preview: "rascunho" }),
    ]);
    renderAt("/assistant");

    await screen.findByRole("link", { name: /Endereços em wallet/ });
    await userEvent.type(screen.getByLabelText(/search sessions/i), "wallet");

    expect(screen.getByRole("link", { name: /Endereços em wallet/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Plano de testes/ })).not.toBeInTheDocument();
  });

  it("filters sessions by type, status, and project from the drawer", async () => {
    mockRecents([
      makeSession({
        id: "chat:7",
        kind: "chat",
        threadId: 7,
        title: "Planning chat",
        projectSlug: "app",
        projectName: "App",
        status: "Active",
        statusKind: "active",
      }),
      makeSession({
        id: "codex:ABC-12",
        kind: "codex",
        threadId: null,
        identifier: "ABC-12",
        title: "Fix login",
        projectSlug: "app",
        projectName: "App",
        status: "Aborted",
        statusKind: "aborted",
      }),
      makeSession({
        id: "codex:OPS-1",
        kind: "codex",
        threadId: null,
        identifier: "OPS-1",
        title: "Ops cleanup",
        projectSlug: "ops",
        projectName: "Ops",
        status: "Aborted",
        statusKind: "aborted",
      }),
    ]);
    renderAt("/assistant");

    await userEvent.click(await screen.findByRole("button", { name: "Filters" }));
    const executionFilter = screen.getByRole("button", { name: "Execution" });
    const abortedFilter = screen.getByRole("button", { name: "Aborted" });
    expect(within(executionFilter).getByRole("img", { name: "Execution" })).toBeInTheDocument();
    expect(within(abortedFilter).getByRole("img", { name: "Aborted" })).toBeInTheDocument();

    await userEvent.click(executionFilter);
    await userEvent.click(abortedFilter);
    await userEvent.click(screen.getByRole("button", { name: "App" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByRole("link", { name: /Fix login/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Planning chat/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ops cleanup/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters (3)" })).toBeInTheDocument();
  });

  it("applies assistant filters from the URL", async () => {
    mockRecents([
      makeSession({
        id: "chat:7",
        kind: "chat",
        threadId: 7,
        title: "Planning chat",
        projectSlug: "app",
        status: "Active",
        statusKind: "active",
      }),
      makeSession({
        id: "codex:ABC-12",
        kind: "codex",
        threadId: null,
        identifier: "ABC-12",
        title: "Fix login",
        projectSlug: "app",
        status: "Aborted",
        statusKind: "aborted",
      }),
    ]);
    renderAt("/assistant?type=execution&status=aborted&project=app");

    expect(await screen.findByRole("link", { name: /Fix login/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Planning chat/ })).not.toBeInTheDocument();
  });

  it("creates a new chat from the page header", async () => {
    renderAt("/assistant");

    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(createChat).toHaveBeenCalledTimes(1);
  });

  it("opens the split chat and files panel for the selected thread id", async () => {
    renderAt("/assistant/7");

    expect(await screen.findByTestId("assistant-panel")).toHaveTextContent("panel:7");
  });

  it("shows archive on session rows", async () => {
    renderAt("/assistant");

    expect(await screen.findByRole("button", { name: /archive session/i })).toBeInTheDocument();
  });
});
