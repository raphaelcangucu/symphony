import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RecentsSection } from "@/components/layout/RecentsSection";
import * as useRecentsModule from "@/hooks/useRecents";
import type { RecentSession } from "@/types/recents";

vi.mock("@/hooks/useRecents");

const session: RecentSession = {
  id: "chat:7", kind: "chat", scope: "freeform", projectSlug: null, projectName: null,
  title: "Brainstorm ideas", identifier: null, threadId: 7, status: "Active", statusKind: "active",
  preview: "let's", updatedAt: "2026-05-30T00:00:00Z",
};

function mockRecents(value: Partial<ReturnType<typeof useRecentsModule.useRecents>>) {
  vi.mocked(useRecentsModule.useRecents).mockReturnValue({
    sessions: [], loading: false, refetch: vi.fn(), ...value,
  });
}

describe("RecentsSection", () => {
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
});
