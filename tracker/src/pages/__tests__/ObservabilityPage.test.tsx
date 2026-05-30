import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ObservabilityPage } from "../ObservabilityPage";
import type { RuntimeObservability } from "@/types/observability";

const runtime: RuntimeObservability = {
  runtimeId: "r1",
  label: "macro-markets",
  projectSlug: "macro-markets",
  trackerKind: "local",
  agentKind: "codex",
  sourceUrl: "http://localhost:4001",
  status: "online",
  reportedAt: new Date().toISOString(),
  counts: { running: 1, retrying: 0 },
  agentTotals: { inputTokens: 1, outputTokens: 2, totalTokens: 3, secondsRunning: 0 },
  rateLimits: null,
  running: [
    {
      issueIdentifier: "MM-1",
      state: "In Progress",
      sessionId: "sess-1",
      turnCount: 2,
      lastEvent: "agent_message",
      lastMessage: "working",
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      tokens: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    },
  ],
  retrying: [],
};

vi.mock("@/hooks/useObservability", () => ({
  useObservability: () => ({ runtimes: [runtime], loading: false }),
}));

describe("ObservabilityPage", () => {
  it("renders a runtime card and the global sessions table row", () => {
    render(<ObservabilityPage />);
    expect(screen.getAllByText("macro-markets").length).toBeGreaterThan(0);
    expect(screen.getByText("MM-1")).toBeInTheDocument();
    expect(screen.getByText(/online/i)).toBeInTheDocument();
  });
});
