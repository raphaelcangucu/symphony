import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPage } from "../AssistantPage";
import type { AssistantThread } from "@/types/assistant-thread";

let threads: AssistantThread[];
const listAssistantThreads = vi.fn(() => Promise.resolve(threads));
const createFreeformThread = vi.fn();

vi.mock("@/services/assistantThreads", () => ({
  listAssistantThreads: (...args: unknown[]) => listAssistantThreads(...(args as [])),
  createFreeformThread: (...args: unknown[]) => createFreeformThread(...(args as [])),
}));

vi.mock("@/components/assistant/ProjectAssistantPanel", () => ({
  ProjectAssistantPanel: ({ threadId }: { threadId?: number }) => (
    <div data-testid="assistant-panel">panel:{threadId ?? "none"}</div>
  ),
}));

function makeThread(overrides: Partial<AssistantThread> = {}): AssistantThread {
  return {
    id: 1,
    scope: "freeform",
    projectSlug: null,
    projectName: null,
    issueIdentifier: null,
    title: null,
    status: "active",
    preview: null,
    updatedAt: "2026-05-30T12:00:00Z",
    ...overrides,
  };
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
    listAssistantThreads.mockClear();
    createFreeformThread.mockClear();
    threads = [
      makeThread({ id: 7, title: "Endereços em wallet", preview: "como derivar" }),
      makeThread({ id: 8, title: null, preview: "rascunho rápido" }),
    ];
  });

  it("lists freeform chats from the threads service", async () => {
    renderAt("/assistant");

    expect(await screen.findByRole("link", { name: /Endereços em wallet/ })).toHaveAttribute(
      "href",
      "/assistant/7",
    );
    expect(screen.getByRole("link", { name: /rascunho rápido/ })).toHaveAttribute("href", "/assistant/8");
    expect(listAssistantThreads).toHaveBeenCalledWith("freeform");
  });

  it("shows an empty placeholder when no thread is selected", async () => {
    renderAt("/assistant");

    await screen.findByRole("link", { name: /Endereços em wallet/ });
    expect(screen.queryByTestId("assistant-panel")).not.toBeInTheDocument();
    expect(screen.getByText(/select a chat or start a new one/i)).toBeInTheDocument();
  });

  it("opens the panel for the selected thread id", async () => {
    renderAt("/assistant/7");

    expect(await screen.findByTestId("assistant-panel")).toHaveTextContent("panel:7");
  });

  it("creates a new chat and navigates to it", async () => {
    createFreeformThread.mockResolvedValueOnce(makeThread({ id: 42, title: null }));
    renderAt("/assistant");

    await screen.findByRole("link", { name: /Endereços em wallet/ });
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));

    await waitFor(() => expect(createFreeformThread).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("assistant-panel")).toHaveTextContent("panel:42");
  });
});
