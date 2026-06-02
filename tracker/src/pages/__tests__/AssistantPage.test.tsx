import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPage } from "../AssistantPage";
import * as useRecentsModule from "@/hooks/useRecents";
import * as useCreateFreeformChatModule from "@/hooks/useCreateFreeformChat";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useRecents");
vi.mock("@/hooks/useCreateFreeformChat");

vi.mock("@/components/assistant/FreeformAssistantPanel", () => ({
  FreeformAssistantPanel: ({ threadId }: { threadId: number }) => (
    <div data-testid="assistant-panel">panel:{threadId}</div>
  ),
}));

const createChat = vi.fn();

function makeSession(overrides: Partial<RecentSession> = {}): RecentSession {
  return {
    id: "chat:1", kind: "chat", scope: "freeform", projectSlug: null, projectName: null,
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
    vi.mocked(useCreateFreeformChatModule.useCreateFreeformChat).mockReturnValue({ creating: false, createChat });
    mockRecents([
      makeSession({ id: "chat:7", threadId: 7, title: "Endereços em wallet", preview: "como derivar" }),
      makeSession({ id: "codex:ABC-12", kind: "codex", scope: null, threadId: null, identifier: "ABC-12", title: "Fix login", projectSlug: "app" }),
    ]);
  });

  it("lists chat sessions and excludes codex rows", async () => {
    renderAt("/assistant");

    expect(await screen.findByRole("link", { name: /Endereços em wallet/ })).toHaveAttribute("href", "/assistant/7");
    expect(screen.queryByRole("link", { name: /Fix login/ })).not.toBeInTheDocument();
  });

  it("filters conversations by the search query", async () => {
    mockRecents([
      makeSession({ id: "chat:7", threadId: 7, title: "Endereços em wallet", preview: "como derivar" }),
      makeSession({ id: "chat:8", threadId: 8, title: "Plano de testes", preview: "rascunho" }),
    ]);
    renderAt("/assistant");

    await screen.findByRole("link", { name: /Endereços em wallet/ });
    await userEvent.type(screen.getByLabelText(/search conversations/i), "wallet");

    expect(screen.getByRole("link", { name: /Endereços em wallet/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Plano de testes/ })).not.toBeInTheDocument();
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
});
