import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAssistantCatalogBundle } from "@/services/assistant";

let ProjectAssistantPanel: typeof import("@/components/assistant/ProjectAssistantPanel").ProjectAssistantPanel;

const channelHandlers: Record<string, (payload: unknown) => void> = {};
type ReceiveCallbacks = Record<string, (response: unknown) => void>;
const pushReceives: ReceiveCallbacks[] = [];
const navigateMock = vi.hoisted(() => vi.fn());
const push = vi.fn((event: string, payload?: unknown) => {
  void event;
  void payload;
  const callbacks: ReceiveCallbacks = {};
  const result = {
    receive: (status: string, callback: (response: unknown) => void) => {
      callbacks[status] = callback;
      return result;
    },
  };
  pushReceives.push(callbacks);
  return result;
});
const join = vi.fn(() => ({ receive: (status: string, callback: (response: unknown) => void) => (status === "ok" ? callback({}) : undefined) }));
const leave = vi.fn(() => ({ receive: vi.fn() }));
const channel = {
  on: (event: string, callback: (payload: unknown) => void) => {
    channelHandlers[event] = callback;
  },
  join,
  leave,
  push,
};
const connect = vi.fn();
const disconnect = vi.fn();
const socketChannel = vi.fn(() => channel);

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useExternalStoreRuntime: () => ({}),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null, key: "test" }),
  useNavigate: () => navigateMock,
}));

vi.mock("@/services/assistant", async () => {
  const actual = await vi.importActual<typeof import("@/services/assistant")>("@/services/assistant");
  const mockCodexCatalog = {
    agent: "codex" as const,
    agentLabel: "Codex CLI",
    command: "codex app-server",
    defaultModel: "gpt-5.3-codex",
    models: [
      {
        id: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        label: "GPT-5.3 Codex",
        isDefault: true,
        defaultEffort: "low",
        efforts: [{ id: "low", label: "Low" }],
      },
    ],
  };
  return {
    ...actual,
    fetchAssistantCatalogBundle: vi.fn(async () => ({
      agents: [mockCodexCatalog],
      defaultAgent: "codex" as const,
    })),
    fetchAssistantCodexCatalog: vi.fn(async () => mockCodexCatalog),
  };
});

vi.mock("@/services/phoenix/socket", () => ({
  createTrackerSocket: () => ({
    connect,
    disconnect,
    channel: socketChannel,
  }),
}));

vi.mock("@/hooks/useAssistantCommands", () => ({
  useAssistantCommands: () => ({ commands: [], isLoading: false, error: null }),
}));

const listIssuesMock = vi.hoisted(() => vi.fn());
const searchWorkspaceFilesMock = vi.hoisted(() => vi.fn());
const listPullRequestsMock = vi.hoisted(() => vi.fn());
const getThreadGitDiffMock = vi.hoisted(() => vi.fn());
const getGitDiffMock = vi.hoisted(() => vi.fn());
const getProjectOverviewMock = vi.hoisted(() => vi.fn());
const getRepoTreeMock = vi.hoisted(() => vi.fn());
const getPageMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/issues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/issues")>()),
  listIssues: (...args: unknown[]) => listIssuesMock(...args),
}));

vi.mock("@/services/workspaceFiles", () => ({
  searchWorkspaceFiles: (...args: unknown[]) => searchWorkspaceFilesMock(...args),
}));

vi.mock("@/services/pullRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pullRequests")>()),
  listPullRequests: (...args: unknown[]) => listPullRequestsMock(...args),
}));

vi.mock("@/services/gitDiff", () => ({
  getThreadGitDiff: (...args: unknown[]) => getThreadGitDiffMock(...args),
  getGitDiff: (...args: unknown[]) => getGitDiffMock(...args),
}));

vi.mock("@/services/knowledgeBase", () => ({
  getProjectOverview: (...args: unknown[]) => getProjectOverviewMock(...args),
  getRepoTree: (...args: unknown[]) => getRepoTreeMock(...args),
  getPage: (...args: unknown[]) => getPageMock(...args),
}));

beforeAll(async () => {
  ({ ProjectAssistantPanel } = await import("@/components/assistant/ProjectAssistantPanel"));
});

describe("ProjectAssistantPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    if (typeof CSSStyleSheet !== "undefined" && !CSSStyleSheet.prototype.replaceSync) {
      Object.defineProperty(CSSStyleSheet.prototype, "replaceSync", {
        configurable: true,
        value: vi.fn(),
      });
    }
    navigateMock.mockReset();
    listIssuesMock.mockResolvedValue([]);
    searchWorkspaceFilesMock.mockResolvedValue([]);
    listPullRequestsMock.mockResolvedValue({ data: [] });
    getThreadGitDiffMock.mockResolvedValue({ repos: [], workspace: { path: "", available: false } });
    getGitDiffMock.mockResolvedValue({ repos: [], workspace: { path: "", available: false } });
    getProjectOverviewMock.mockResolvedValue({
      project: { slug: "macro-markets", name: "Macro Markets" },
      repositories: [
        {
          repoSlug: "front",
          workspacePath: "front",
          githubFullName: null,
          role: null,
          docsPresent: true,
        },
      ],
    });
    getRepoTreeMock.mockResolvedValue({
      repository: {
        repoSlug: "front",
        workspacePath: "front",
        githubFullName: null,
        role: null,
        docsPresent: true,
      },
      docsPresent: true,
      tree: [
        {
          type: "folder",
          name: "Guides",
          title: "Guides",
          path: "guides",
          order: null,
          favorite: false,
          children: [
            {
              type: "page",
              name: "Setup",
              title: "Setup",
              path: "guides/setup.md",
              order: null,
              favorite: false,
              children: [],
            },
          ],
        },
      ],
    });
    getPageMock.mockResolvedValue({
      path: "guides/setup.md",
      title: "Setup",
      frontmatter: {},
      body: "# Setup\n\nConfigure the project.",
      markdown: "# Setup\n\nConfigure the project.",
    });
    for (const key of Object.keys(channelHandlers)) delete channelHandlers[key];
    pushReceives.length = 0;
  });

  it("uses a compact page header for project assistants", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    const header = screen.getByTestId("project-assistant-compact-header");
    expect(header).toHaveClass("py-2");
    expect(within(header).getByRole("heading", { name: "Project assistant" })).toBeTruthy();
    expect(within(header).getByText("macro-markets")).toBeTruthy();
    expect(screen.queryByText(/AI coding assistant for/i)).not.toBeInTheDocument();
  });

  it("renders a routed project assistant page, loads history, streams a response, and sends through the channel", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    expect(screen.getByRole("region", { name: "Project assistant" })).toBeTruthy();
    expect(socketChannel).toHaveBeenCalledWith("assistant:macro-markets");

    channelHandlers["history_loaded"]({
      messages: [{ id: 1, role: "assistant", content: "Historico carregado", tool_calls: [] }],
    });

    expect(await screen.findByText("Historico carregado")).toBeTruthy();

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "Oi" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "send_message",
        expect.objectContaining({
          message: "Oi",
          context: expect.objectContaining({
            view: "board",
            agent: "codex",
            model: expect.any(String),
            effort: expect.any(String),
          }),
          attachments: expect.any(Array),
        }),
      ),
    );

    channelHandlers["message_created"]({ message: { id: 2, role: "user", content: "Oi", tool_calls: [] } });
    channelHandlers["assistant_delta"]({ delta: "Olá" });
    channelHandlers["assistant_delta"]({ delta: ", posso ajudar." });
    channelHandlers["assistant_completed"]({
      message: {
        id: 3,
        role: "assistant",
        content: "Olá, posso ajudar.",
        tool_calls: [{ name: "list_issues", status: "complete", result: { issues: [] } }],
      },
    });

    expect(await screen.findByText("Oi")).toBeTruthy();
    expect(await screen.findByText("Olá, posso ajudar.")).toBeTruthy();
    expect(screen.getByText("List issues")).toBeTruthy();
  });

  it("reports KB document references found in assistant messages", async () => {
    const onKbDocumentReferencesChanged = vi.fn();

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        view="board"
        mode="page"
        onKbDocumentReferencesChanged={onKbDocumentReferencesChanged}
      />,
    );

    channelHandlers["history_loaded"]({
      messages: [
        {
          id: 1,
          role: "assistant",
          content: "Veja [spec](docs/market/polymarket-omnibus-spec.md).",
          tool_calls: [
            {
              name: "kb_create_page",
              status: "complete",
              result: { path: "docs/market/polymarket-omnibus-plan.md" },
            },
          ],
        },
      ],
    });

    await waitFor(() =>
      expect(onKbDocumentReferencesChanged).toHaveBeenLastCalledWith([
        "market/polymarket-omnibus-spec.md",
        "market/polymarket-omnibus-plan.md",
      ]),
    );
  });

  it("keeps the composer controls in place while assistant config is loading", () => {
    vi.mocked(fetchAssistantCatalogBundle).mockImplementationOnce(() => new Promise(() => {}));

    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "oi" } });

    expect(textarea).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Codex" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /gpt-5/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /low|medium/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attach file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record audio" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    expect(push).not.toHaveBeenCalledWith("send_message", expect.anything());
  });

  it("opens the project knowledge base from the composer button and shortcut", async () => {
    render(
      <MemoryRouter>
        <ProjectAssistantPanel projectSlug="macro-markets" threadId={7990} view="board" mode="page" />
      </MemoryRouter>,
    );

    const kbButton = await screen.findByRole("button", { name: /knowledge base/i });
    await waitFor(() => expect(kbButton).not.toBeDisabled());
    fireEvent.click(kbButton);
    expect(await screen.findByRole("dialog", { name: "Knowledge Base" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Knowledge Base" })).not.toBeInTheDocument());
    await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    expect(await screen.findByRole("dialog", { name: "Knowledge Base" })).toBeInTheDocument();
  });

  it("shows uncommitted diff totals in the session header", async () => {
    getThreadGitDiffMock.mockResolvedValue({
      repos: [
        {
          repo: "front",
          files: [
            {
              path: "src/App.tsx",
              oldPath: null,
              status: "modified",
              patch: "diff --git a/src/App.tsx b/src/App.tsx\n-old\n+new\n+another\n",
            },
          ],
        },
      ],
      workspace: { path: "/tmp/ws", available: true },
    });

    render(<ProjectAssistantPanel projectSlug="macro-markets" threadId={7990} view="board" mode="page" />);

    await waitFor(() => expect(getThreadGitDiffMock).toHaveBeenCalledWith(7990, "uncommitted"));
    expect(await screen.findByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("queues a message submitted while running and auto-sends it on completion", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "first" })),
    );
    channelHandlers["assistant_delta"]({ delta: "working" });

    fireEvent.change(textarea, { target: { value: "second" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("second")).toBeTruthy();
    expect(push).not.toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "second" }));

    channelHandlers["assistant_completed"]({ message: { id: 9, role: "assistant", content: "done", tool_calls: [] } });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "second" })),
    );
  });

  it("removes a queued message when its chip remove button is clicked", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalled());
    channelHandlers["assistant_delta"]({ delta: "working" });

    fireEvent.change(textarea, { target: { value: "queued one" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    const removeButton = await screen.findByRole("button", { name: /remove queued message/i });
    fireEvent.click(removeButton);

    await waitFor(() => expect(screen.queryByText("queued one")).toBeNull());
  });

  it("force-sends a queued message via steer when its send button is clicked", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalled());
    channelHandlers["assistant_delta"]({ delta: "working" });

    fireEvent.change(textarea, { target: { value: "send me now" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    const sendNow = await screen.findByRole("button", { name: /send queued message now/i });
    fireEvent.click(sendNow);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("steer_turn", expect.objectContaining({ message: "send me now" })),
    );
    await waitFor(() => expect(screen.queryByText("send me now")).toBeNull());
  });

  it("steers a running turn when /infer is submitted, and falls back to queue on steer_failed", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "do work" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("send_message", expect.objectContaining({ message: "do work" })),
    );
    channelHandlers["assistant_delta"]({ delta: "..." });

    fireEvent.change(textarea, { target: { value: "/infer prefer the simpler fix" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("steer_turn", expect.objectContaining({ message: "prefer the simpler fix" })),
    );

    channelHandlers["steer_failed"]({ reason: "ActiveTurnNotSteerable", message: "prefer the simpler fix" });
    expect(await screen.findByText("prefer the simpler fix")).toBeTruthy();
  });

  it("runs an authoring goal in the chat and shows its banner when /goal is submitted", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "/goal ship the feature" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("set_goal_mode", { goal_mode: true, objective: "ship the feature" }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "send_message",
        expect.objectContaining({ message: expect.stringContaining("ship the feature") }),
      ),
    );
    // The framed instruction is authoring-only: it explicitly tells Codex NOT to dispatch the
    // orchestrator and to run the goal directly in the conversation.
    const goalSend = push.mock.calls.find(
      ([event, payload]) =>
        event === "send_message" &&
        typeof (payload as { message?: string })?.message === "string" &&
        (payload as { message: string }).message.includes("ship the feature"),
    );
    const goalSendMessage = (goalSend?.[1] as { message: string }).message;
    expect(goalSendMessage).toMatch(/authoring goal/i);
    expect(goalSendMessage).toMatch(/do not dispatch the orchestrator/i);

    // Resolving the set_goal_mode push surfaces the Authoring goal banner.
    const goalCallIndex = push.mock.calls.findIndex(([event]) => event === "set_goal_mode");
    pushReceives[goalCallIndex]?.ok?.({ goal_mode: true, goal_objective: "ship the feature" });

    const banner = await screen.findByRole("status", { name: "Authoring goal" });
    expect(banner).toHaveTextContent("ship the feature");
  });

  it("rehydrates the authoring goal banner from the join response", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok"
          ? callback({ goal_mode: true, goal_objective: "Audit the auth module", thread_id: 1 })
          : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    const banner = await screen.findByRole("status", { name: "Authoring goal" });
    expect(banner).toHaveTextContent("Audit the auth module");
  });

  it("shows a Resume button when the last turn was interrupted and pushes resume_turn on click", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok"
          ? callback({ messages: [], thread_id: 1, last_turn: { status: "interrupted", can_resume: true } })
          : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    const button = await screen.findByRole("button", { name: /resume/i });
    fireEvent.click(button);
    expect(push).toHaveBeenCalledWith("resume_turn", {});
  });

  it("requests native goal status on join and shows pause while a goal is running", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, goal_objective: "Audit", thread_id: 1 }) : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    await screen.findByRole("status", { name: "Authoring goal" });

    // Channel asks for the native goal after join.
    expect(push).toHaveBeenCalledWith("goal_status", {});

    // Native goal is active and a turn is streaming → the pill shows Pause + timer.
    channelHandlers["goal_status"]({
      enabled: true,
      objective: "Audit",
      native: true,
      goal: { kind: "goal", source: "native", status: "active", timeUsedSeconds: 42 },
      running: true,
    });
    channelHandlers["goal_running"]({ running: true });

    const pause = await screen.findByRole("button", { name: "Pause goal" });
    const pill = screen.getByRole("status", { name: "Authoring goal" });
    expect(pill.textContent ?? "").toMatch(/\d+s/);

    fireEvent.click(pause);
    expect(push).toHaveBeenCalledWith("goal_pause", {});
  });

  it("resumes a stalled native goal from the pill", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, goal_objective: "Audit", thread_id: 1 }) : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    await screen.findByRole("status", { name: "Authoring goal" });

    // Native goal exists and is active but no turn is streaming → stalled, offer Resume.
    channelHandlers["goal_status"]({
      enabled: true,
      objective: "Audit",
      native: true,
      goal: { kind: "goal", source: "native", status: "active", timeUsedSeconds: 10 },
      running: false,
    });

    const resume = await screen.findByRole("button", { name: "Resume goal" });
    fireEvent.click(resume);
    expect(push).toHaveBeenCalledWith("goal_resume", {});
  });

  it("removes and edits the authoring goal objective from the pill", async () => {
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, goal_objective: "Audit", thread_id: 1 }) : undefined,
    }));

    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);
    await screen.findByRole("status", { name: "Authoring goal" });

    // Edit: open inline editor, change the objective, save.
    fireEvent.click(await screen.findByRole("button", { name: "Edit objective" }));
    const editor = await screen.findByPlaceholderText("Describe the authoring objective…");
    fireEvent.change(editor, { target: { value: "Audit the admin UI" } });
    fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
    expect(push).toHaveBeenCalledWith("goal_set_objective", { objective: "Audit the admin UI" });

    // Remove: clears the goal entirely.
    fireEvent.click(await screen.findByRole("button", { name: "Remove goal" }));
    expect(push).toHaveBeenCalledWith("goal_clear", {});
  });

  it("opens an overlay and streams the answer when /btw is submitted", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);
    const textarea = await screen.findByPlaceholderText("Write a message...");

    fireEvent.change(textarea, { target: { value: "/btw what is useMemo" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("btw", expect.objectContaining({ message: "what is useMemo" })),
    );

    const btwCallIndex = push.mock.calls.findIndex(([event]) => event === "btw");
    pushReceives[btwCallIndex]?.ok?.({ btw_id: "btw-1" });

    channelHandlers["btw_delta"]({ btw_id: "btw-1", delta: "useMemo memoizes" });
    expect(await screen.findByText(/useMemo memoizes/)).toBeTruthy();

    channelHandlers["btw_completed"]({ btw_id: "btw-1", message: "useMemo memoizes a value." });
    expect(await screen.findByText("useMemo memoizes a value.")).toBeTruthy();
  });

  it("joins an issue-scoped assistant topic when an issue identifier is provided", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    expect(socketChannel).toHaveBeenCalledWith("assistant:issue:macro-markets:MAC-1");
  });

  it("reports a created draft issue when the completed assistant message includes create_draft_issue", async () => {
    const onDraftIssueCreated = vi.fn();

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        view="board"
        mode="page"
        onDraftIssueCreated={onDraftIssueCreated}
      />,
    );

    await waitFor(() => expect(channelHandlers["assistant_completed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_completed"]({
      message: {
        id: 7,
        role: "assistant",
        content: "Drafted MAC-7.",
        tool_calls: [
          {
            name: "create_draft_issue",
            status: "complete",
            result: {
              tool: "create_draft_issue",
              message: "Created draft MAC-7",
              data: { id: 7, identifier: "MAC-7", title: "Draft issue" },
            },
          },
        ],
      },
    });

    expect(onDraftIssueCreated).toHaveBeenCalledWith({ identifier: "MAC-7" });
  });

  it("reports issue-created events from the channel", async () => {
    const onIssueCreated = vi.fn();

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        view="board"
        mode="page"
        onIssueCreated={onIssueCreated}
      />,
    );

    await waitFor(() => expect(channelHandlers["assistant_issue_created"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_issue_created"]({ identifier: "MAC-8", thread_id: 88 });

    expect(onIssueCreated).toHaveBeenCalledWith({ identifier: "MAC-8", threadId: 88 });
  });

  it("sends set_goal_mode through the issue channel when goal mode is enabled", async () => {
    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={false}
      />,
    );

    await waitFor(() => expect(join).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalledWith("set_goal_mode", expect.anything());

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={true}
      />,
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("set_goal_mode", { goal_mode: true }));
  });

  it("rehydrates an enabled goal mode from the join response", async () => {
    const onIssueGoalModeChanged = vi.fn();
    join.mockImplementation(() => ({
      receive: (status: string, callback: (response: unknown) => void) =>
        status === "ok" ? callback({ goal_mode: true, thread_id: 1 }) : undefined,
    }));

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={false}
        onIssueGoalModeChanged={onIssueGoalModeChanged}
      />,
    );

    await waitFor(() => expect(onIssueGoalModeChanged).toHaveBeenCalledWith(true));
  });

  it("pushes dispatch_coding_agent with the current goal mode when dispatch is requested", async () => {
    const onDispatchSucceeded = vi.fn();
    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={true}
        dispatchRequestId={0}
        onDispatchSucceeded={onDispatchSucceeded}
      />,
    );

    await waitFor(() => expect(join).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalledWith("dispatch_coding_agent", expect.anything());

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
        issueGoalMode={true}
        dispatchRequestId={1}
        onDispatchSucceeded={onDispatchSucceeded}
      />,
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("dispatch_coding_agent", expect.objectContaining({ goal_mode: true })),
    );

    const dispatchCallIndex = push.mock.calls.findIndex(([event]) => event === "dispatch_coding_agent");
    pushReceives[dispatchCallIndex]?.ok?.({ message: "Requested Codex work on MAC-1" });
    expect(onDispatchSucceeded).toHaveBeenCalledWith("Requested Codex work on MAC-1");
  });

  it("renders plan approval actions in issue chat and dispatches the selected execution mode", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["history_loaded"]).toEqual(expect.any(Function)));

    channelHandlers["history_loaded"]({
      messages: [
        {
          id: 10,
          role: "assistant",
          content: "Planning complete.",
          tool_calls: [
            {
              name: "update_plan",
              status: "complete",
              arguments: {
                plan: [
                  { step: "Write tests", status: "completed" },
                  { step: "Implement", status: "pending" },
                ],
              },
            },
          ],
        },
      ],
    });

    fireEvent.click(await screen.findByRole("button", { name: "YOLO" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "dispatch_coding_agent",
        expect.objectContaining({ goal_mode: false, mode: "yolo" }),
      ),
    );

    push.mockClear();

    channelHandlers["history_loaded"]({
      messages: [
        {
          id: 11,
          role: "assistant",
          content: "Updated plan.",
          tool_calls: [
            {
              name: "update_plan",
              status: "complete",
              arguments: { plan: [{ step: "Ship", status: "pending" }] },
            },
          ],
        },
      ],
    });

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "dispatch_coding_agent",
        expect.objectContaining({ goal_mode: false, mode: "build" }),
      ),
    );
  });

  it("hides stale plan approval actions once the user has followed up", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["history_loaded"]).toEqual(expect.any(Function)));

    channelHandlers["history_loaded"]({
      messages: [
        {
          id: 20,
          role: "assistant",
          content: "Plan ready.",
          tool_calls: [
            {
              name: "update_plan",
              status: "complete",
              arguments: { plan: [{ step: "Implement", status: "pending" }] },
            },
          ],
        },
        { id: 21, role: "user", content: "Wait, change the scope.", tool_calls: [] },
      ],
    });

    expect(await screen.findByText("Wait, change the scope.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "YOLO" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("renders inline command approval requests and submits approval through the channel", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["approval_required"]).toEqual(expect.any(Function)));

    channelHandlers["approval_required"]({
      request_id: "cmd-1",
      command: "npm test -- --runInBand",
      cwd: "/workspace/app",
      reason: "unknown",
    });

    expect(await screen.findByText("Codex wants to run a command")).toBeInTheDocument();
    expect(screen.getByText("npm test -- --runInBand")).toBeInTheDocument();
    expect(screen.getByText("/workspace/app")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("submit_approval", {
        request_id: "cmd-1",
        action: "approve",
      }),
    );
  });

  it("adds agent command approval details to composer context", async () => {
    const user = userEvent.setup();
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["approval_required"]).toEqual(expect.any(Function)));

    channelHandlers["approval_required"]({
      request_id: "cmd-1",
      command: "npm test",
      cwd: "/workspace/app",
      reason: "unknown",
    });

    await user.click(await screen.findByRole("button", { name: "Add to context" }));

    expect(screen.getByText("permission:cmd-1")).toBeInTheDocument();
    expect(screen.getAllByText("Codex wants to run a command").length).toBeGreaterThan(1);

    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "send_message",
        expect.objectContaining({
          context_refs: [
            expect.objectContaining({
              type: "security",
              id: "permission:cmd-1",
              content: expect.stringContaining("npm test"),
            }),
          ],
        }),
      ),
    );
  });

  it("opens a large knowledge base modal with a collapsible tree", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />
      </MemoryRouter>,
    );

    const kbButton = await screen.findByRole("button", { name: "Knowledge Base" });
    await waitFor(() => expect(kbButton).not.toBeDisabled());
    await user.click(kbButton);

    expect(await screen.findByRole("dialog", { name: "Knowledge Base" })).toBeInTheDocument();
    expect(await screen.findByText("front")).toBeInTheDocument();
    expect(await screen.findByText("Setup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Setup to context" }));

    expect(await screen.findByText("kb:front:guides/setup.md")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Setup" }));

    expect(await screen.findByText("Configure the project.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show tree" })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalledWith("/projects/macro-markets/kb/front/guides/setup.md");
  });

  it("renders an embedded assistant without viewport height", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="embedded" />);

    const region = screen.getByRole("region", { name: "Project assistant" });
    expect(region).toHaveClass("h-full");
    expect(region).not.toHaveClass("h-[calc(100vh-4rem)]");
    expect(region).not.toHaveClass("h-screen");
    expect(socketChannel).toHaveBeenCalledWith("assistant:issue:macro-markets:MAC-1");
  });

  it("renders a nested issue assistant page without viewport height", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    const region = screen.getByRole("region", { name: "Project assistant" });
    expect(region).toHaveClass("h-full");
    expect(region).not.toHaveClass("h-[calc(100vh-4rem)]");
  });

  it("renders a thread assistant page without viewport height", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" threadId={42} view="board" mode="page" />);

    const region = screen.getByRole("region", { name: "Project assistant" });
    expect(region).toHaveClass("h-full");
    expect(region).not.toHaveClass("h-[calc(100vh-4rem)]");
    expect(socketChannel).toHaveBeenCalledWith("assistant:thread:42");
  });

  it("keeps thread id topic priority over issue identifier", () => {
    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        threadId={42}
        issueIdentifier="MAC-1"
        view="board"
        mode="page"
      />,
    );

    expect(socketChannel).toHaveBeenCalledWith("assistant:thread:42");
  });

  it("surfaces assistant document change events from the channel", async () => {
    const onDocumentChanged = vi.fn();

    render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        view="board"
        mode="page"
        onDocumentChanged={onDocumentChanged}
      />,
    );

    await waitFor(() => expect(channelHandlers["assistant_document_changed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_document_changed"]({ identifier: "MAC-1" });

    expect(onDocumentChanged).toHaveBeenCalledWith({ identifier: "MAC-1" });
  });

  it("does not reconnect the channel when onDocumentChanged identity changes", async () => {
    const onDocumentChanged = vi.fn();

    const { rerender } = render(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="embedded"
        onDocumentChanged={onDocumentChanged}
      />,
    );

    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));

    const leaveCallsBefore = leave.mock.calls.length;

    rerender(
      <ProjectAssistantPanel
        projectSlug="macro-markets"
        issueIdentifier="MAC-1"
        view="board"
        mode="embedded"
        onDocumentChanged={vi.fn()}
      />,
    );

    expect(leave).toHaveBeenCalledTimes(leaveCallsBefore);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("renders file-edit tool calls as a file-activity card and keeps other tools generic", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["assistant_completed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_completed"]({
      message: {
        id: 42,
        role: "assistant",
        content: "Done.",
        tool_calls: [
          { name: "apply_patch", status: "complete", result: { paths: ["lib/foo.ex"], additions: 12, deletions: 3, diff: "@@\n+a" } },
          { name: "list_issues", status: "complete", result: { issues: [] } },
        ],
      },
    });

    expect(await screen.findByText("lib/foo.ex")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
    // Non-file tool call still uses the generic block.
    expect(screen.getByText("List issues")).toBeInTheDocument();
  });

  it("shows edited file badges and opens the clicked diff", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["assistant_completed"]).toEqual(expect.any(Function)));

    channelHandlers["assistant_completed"]({
      message: {
        id: 43,
        role: "assistant",
        content: "Updated settings.",
        tool_calls: [
          {
            name: "apply_patch",
            status: "complete",
            result: {
              paths: ["tracker.json", "ProjectConfigEditor.tsx"],
              additions: 25,
              deletions: 8,
              diff: "diff --git a/tracker.json b/tracker.json\n@@ -1 +1 @@\n-old\n+new",
            },
          },
        ],
      },
    });

    expect(await screen.findByText("Edited 2 files:")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View changes to tracker.json" }));

    const dialog = await screen.findByRole("dialog", { name: "Edited file diff" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getAllByText("tracker.json").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("+1")).toBeInTheDocument();
    expect(within(dialog).getByText("-1")).toBeInTheDocument();
  });

  it("replaces the transcript when history_synced arrives after a terminal turn_status", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    await waitFor(() => expect(channelHandlers["history_synced"]).toEqual(expect.any(Function)));

    channelHandlers["history_loaded"]({
      messages: [{ id: 1, role: "user", content: "go", tool_calls: [] }],
    });

    channelHandlers["turn_status"]({ status: "completed" });

    await waitFor(() => expect(push).toHaveBeenCalledWith("sync_history", {}));

    channelHandlers["history_synced"]({
      messages: [
        { id: 1, role: "user", content: "go", tool_calls: [] },
        { id: 2, role: "assistant", content: "done without refresh", tool_calls: [] },
      ],
    });

    expect(await screen.findByText("done without refresh")).toBeInTheDocument();
  });

  it("does not auto-scroll when the user has scrolled away from the bottom", async () => {
    render(
      <ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="embedded" />,
    );

    await waitFor(() => expect(channelHandlers["history_loaded"]).toEqual(expect.any(Function)));

    await act(async () => {
      channelHandlers["history_loaded"]({
        messages: [
          { id: 1, role: "user", content: "hello", tool_calls: [] },
          { id: 2, role: "assistant", content: "initial reply", tool_calls: [] },
        ],
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const scroller = screen.getByText("initial reply").closest(".overflow-y-auto") as HTMLDivElement;
    const scrollTo = vi.spyOn(scroller, "scrollTo").mockImplementation(() => undefined);

    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    scroller.scrollTop = 0;

    await act(async () => {
      fireEvent.scroll(scroller);
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    });

    scrollTo.mockClear();

    await act(async () => {
      channelHandlers["history_synced"]({
        messages: [
          { id: 1, role: "user", content: "hello", tool_calls: [] },
          { id: 2, role: "assistant", content: "reconciled reply", tool_calls: [] },
        ],
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(screen.getByText("reconciled reply")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(0);
  });

  it("shows execution mode and @-mentions on issue assistant routes", async () => {
    listIssuesMock.mockResolvedValue([
      {
        id: "2",
        identifier: "MAC-9",
        title: "Related task",
        status: "Todo",
        priority: 0,
        assignee: null,
        projectSlug: "macro-markets",
        blockedBy: [],
        labels: [],
      },
    ]);

    render(
      <ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-2" view="board" mode="page" />,
    );

    expect(await screen.findByRole("button", { name: /build/i })).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "@mac" } });

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(await screen.findByText("Related task")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "ship it" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "send_message",
        expect.objectContaining({
          message: "ship it",
          context: expect.objectContaining({
            execution_mode: "build",
          }),
        }),
      ),
    );
  });

  it("opens the Magic command palette as a modal on project session routes", async () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" threadId={7990} view="board" mode="page" />);

    expect(await screen.findByRole("button", { name: /build/i })).toBeInTheDocument();
    const magicButton = screen.getByRole("button", { name: /magic/i });
    await waitFor(() => expect(magicButton).not.toBeDisabled());

    // The Magic button opens a centered modal palette — not the inline `/` list.
    fireEvent.click(magicButton);

    const dialog = await screen.findByRole("dialog", { name: "Magic commands" });
    expect(within(dialog).getByText("/plan")).toBeInTheDocument();
    expect(within(dialog).getByText("/push")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Magic commands" })).not.toBeInTheDocument(),
    );

    const textarea = screen.getByPlaceholderText("Write a message...");
    fireEvent.change(textarea, { target: { value: "translate the docs" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "send_message",
        expect.objectContaining({
          message: "translate the docs",
          context: expect.objectContaining({
            execution_mode: "build",
          }),
        }),
      ),
    );
  });

  it("enables issue @-mentions on the project assistant but hides execution mode without an issue", async () => {
    listIssuesMock.mockResolvedValue([
      {
        id: "2",
        identifier: "MAC-9",
        title: "Related task",
        status: "Todo",
        priority: 0,
        assignee: null,
        projectSlug: "macro-markets",
        blockedBy: [],
        labels: [],
      },
    ]);

    render(<ProjectAssistantPanel projectSlug="macro-markets" view="board" mode="page" />);

    const textarea = await screen.findByPlaceholderText("Write a message...");
    expect(screen.queryByRole("button", { name: /build|plan|yolo/i })).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "@mac" } });

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(await screen.findByText("Related task")).toBeInTheDocument();
  });
});
