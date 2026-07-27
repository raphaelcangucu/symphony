import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import type { ComparisonSnapshot } from "./comparison-contract";
import { ComparisonScreen } from "./ComparisonScreen";

function renderScreen(props: Partial<React.ComponentProps<typeof ComparisonScreen>> = {}) {
  const defaults: React.ComponentProps<typeof ComparisonScreen> = {
    snapshot: comparisonSnapshot(),
    connectionState: "live",
    cached: false,
    error: null,
    starting: false,
    retryingCellId: null,
    onBack: jest.fn(),
    onStart: jest.fn(),
    onRetry: jest.fn(),
    onRetryCell: jest.fn(),
    onOpenLog: jest.fn(),
    onOpenPreview: jest.fn(),
    onOpenEvidence: jest.fn(),
  };
  return render(
    <ThemeProvider colorScheme="dark">
      <ComparisonScreen {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe("ComparisonScreen", () => {
  it("shows five evidence-oriented sections and the complete six-cell provenance", () => {
    const onStart = jest.fn();
    const onRetryCell = jest.fn();
    const onOpenLog = jest.fn();
    const onOpenPreview = jest.fn();
    const onOpenEvidence = jest.fn();
    renderScreen({
      onStart,
      onRetryCell,
      onOpenLog,
      onOpenPreview,
      onOpenEvidence,
    });

    for (const section of ["Overview", "Runs", "Previews", "Evidence", "Decision"]) {
      expect(screen.getByText(section)).toBeTruthy();
    }
    expect(screen.getByText("3/6 complete")).toBeTruthy();
    expect(screen.getAllByTestId("comparison-cell")).toHaveLength(6);
    expect(screen.getAllByText("Requested: GPT-5.6 Sol · High")).toHaveLength(2);
    expect(screen.getByText("Resolved: gpt-5.6-sol-2026-07-01 · high")).toBeTruthy();
    expect(screen.getByText("Decision pending")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Run comparison" }));
    fireEvent.press(screen.getByRole("button", { name: "Retry orchestrator-cursor" }));
    fireEvent.press(screen.getByRole("button", { name: "Open session-codex log" }));
    fireEvent.press(screen.getByRole("button", { name: "Open session-codex preview" }));
    fireEvent.press(screen.getByRole("button", { name: "Open session-codex evidence run-1" }));

    expect(onStart).toHaveBeenCalled();
    expect(onRetryCell).toHaveBeenCalledWith("orchestrator-cursor");
    expect(onOpenLog).toHaveBeenCalledWith(expect.objectContaining({ id: "session-codex" }));
    expect(onOpenPreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-codex" }),
      expect.objectContaining({ id: "preview-1" }),
    );
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-codex" }),
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("keeps cached proof visible offline and renders the final ranking", () => {
    const snapshot = comparisonSnapshot();
    snapshot.status = "completed";
    snapshot.progress = { terminal: 6, passed: 5, failed: 1, total: 6 };
    snapshot.decision = {
      winner_cell_id: "session-codex",
      summary: "Session Codex produced the strongest verified Dev10x experience.",
      ranking: [
        { rank: 1, cell_id: "session-codex", score: 96 },
        { rank: 2, cell_id: "orchestrator-claude", score: 92 },
      ],
    };

    renderScreen({
      snapshot,
      connectionState: "offline",
      cached: true,
      error: "Host is offline",
    });

    expect(screen.getByText("Offline · cached evidence")).toBeTruthy();
    expect(screen.getByText("1. Session · Codex · 96")).toBeTruthy();
    expect(
      screen.getByText("Session Codex produced the strongest verified Dev10x experience."),
    ).toBeTruthy();
  });
});

function comparisonSnapshot(): ComparisonSnapshot {
  const ids = [
    ["session-codex", "session", "codex", "passed"],
    ["session-cursor", "session", "cursor", "live"],
    ["session-claude", "session", "claude", "saved"],
    ["orchestrator-codex", "orchestrator", "codex", "starting"],
    ["orchestrator-cursor", "orchestrator", "cursor", "failed"],
    ["orchestrator-claude", "orchestrator", "claude", "live"],
  ] as const;

  return {
    projectSlug: "dev10x",
    identifier: "DEV-1",
    title: "Build the Dev10x landing",
    status: "running",
    progress: { terminal: 3, passed: 2, failed: 1, total: 6 },
    decision: null,
    cells: ids.map(([id, path, provider, status], index) => ({
      id,
      path,
      provider,
      requestedModel:
        provider === "codex"
          ? "gpt-5.6-sol"
          : provider === "cursor"
            ? "cursor-grok-4.5-high"
            : "claude-opus-5",
      requestedEffort: provider === "cursor" ? null : "high",
      effectiveEffort: "high",
      resolvedModel: id === "session-codex" ? "gpt-5.6-sol-2026-07-01" : null,
      resolvedEffort: id === "session-codex" ? "high" : null,
      status,
      attempt: 1,
      issueIdentifier: null,
      threadId: path === "session" ? index + 40 : null,
      executionSessionId: path === "orchestrator" ? index + 70 : null,
      latestMessage: status === "live" ? "Working on the landing page." : null,
      error: status === "failed" ? "Provider disconnected." : null,
      previews:
        id === "session-codex"
          ? [{ id: "preview-1", status: "ready", url: "http://127.0.0.1:23000", port: 23000 }]
          : [],
      evidence:
        id === "session-codex"
          ? [
              {
                id: 1,
                runId: "run-1",
                sessionId: "session-1",
                status: "passed",
                uiChange: true,
                insertedAt: "2026-07-27T10:00:00Z",
                manifest: {
                  issue: "DEV-2",
                  generatedAt: "2026-07-27T10:00:00Z",
                  uiChange: true,
                  runs: [],
                },
              },
            ]
          : [],
    })),
  };
}
