import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecentsSection } from "@/components/layout/RecentsSection";
import * as useRecentsModule from "@/hooks/useRecents";
import * as useCreateFreeformChatModule from "@/hooks/useCreateFreeformChat";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useRecents");
vi.mock("@/hooks/useCreateFreeformChat");

const session: RecentSession = {
  id: "chat:7", kind: "chat", scope: "freeform", projectSlug: null, projectName: null,
  title: "Brainstorm ideas", identifier: null, threadId: 7, status: "Active", statusKind: "active",
  preview: "let's", updatedAt: "2026-05-30T00:00:00Z",
};

const createChat = vi.fn();

function mockRecents(value: Partial<ReturnType<typeof useRecentsModule.useRecents>>) {
  vi.mocked(useRecentsModule.useRecents).mockReturnValue({
    sessions: [], loading: false, refetch: vi.fn(), ...value,
  });
}

describe("RecentsSection", () => {
  beforeEach(() => {
    createChat.mockClear();
    vi.mocked(useCreateFreeformChatModule.useCreateFreeformChat).mockReturnValue({ creating: false, createChat });
  });

  it("renders recent sessions as links with the correct target", () => {
    mockRecents({ sessions: [session] });
    render(<MemoryRouter><RecentsSection /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /Brainstorm ideas/i });
    expect(link).toHaveAttribute("href", "/assistant/7");
  });

  it("shows an empty state when there are no sessions", () => {
    mockRecents({ sessions: [], loading: false });
    render(<MemoryRouter><RecentsSection /></MemoryRouter>);
    expect(screen.getByText(/no recent/i)).toBeInTheDocument();
  });

  it("links to the conversations page via See all", () => {
    mockRecents({ sessions: [] });
    render(<MemoryRouter><RecentsSection /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /see all/i })).toHaveAttribute("href", "/assistant");
  });

  it("creates a new chat when the + button is clicked", async () => {
    mockRecents({ sessions: [] });
    render(<MemoryRouter><RecentsSection /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(createChat).toHaveBeenCalledTimes(1);
  });
});
