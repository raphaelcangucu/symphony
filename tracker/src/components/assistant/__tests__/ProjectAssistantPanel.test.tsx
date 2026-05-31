import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";

const channelHandlers: Record<string, (payload: unknown) => void> = {};
const push = vi.fn(() => ({ receive: vi.fn() }));
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

vi.mock("@/services/assistant", async () => {
  const actual = await vi.importActual<typeof import("@/services/assistant")>("@/services/assistant");
  return {
    ...actual,
    fetchAssistantCodexCatalog: vi.fn(async () => ({
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
    })),
  };
});

vi.mock("@/services/phoenix/socket", () => ({
  createTrackerSocket: () => ({
    connect,
    disconnect,
    channel: socketChannel,
  }),
}));

describe("ProjectAssistantPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(channelHandlers)) delete channelHandlers[key];
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
    expect(screen.getByText("list_issues")).toBeTruthy();
  });

  it("joins an issue-scoped assistant topic when an issue identifier is provided", () => {
    render(<ProjectAssistantPanel projectSlug="macro-markets" issueIdentifier="MAC-1" view="board" mode="page" />);

    expect(socketChannel).toHaveBeenCalledWith("assistant:issue:macro-markets:MAC-1");
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
});
