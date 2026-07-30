import { fireEvent, render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/theme/ThemeProvider";

import { evidenceRecord } from "./EvidenceGallery.test";
import { TaskEvidenceScreen } from "./TaskEvidenceScreen";

describe("TaskEvidenceScreen", () => {
  it("shows task-scoped attempts and routes their logs and artifacts", () => {
    const onOpenArtifact = jest.fn();
    const onOpenLog = jest.fn();
    const record = {
      ...evidenceRecord(),
      provenance: {
        executionPath: "session" as const,
        agentKind: "codex",
        threadId: 42,
        executionSessionId: null,
        requestedModel: "gpt-5.6-sol",
        requestedEffort: "high",
        resolvedModel: "gpt-5.6-sol",
        resolvedEffort: "high",
      },
    };

    render(
      <ThemeProvider colorScheme="dark">
        <TaskEvidenceScreen
          cached={false}
          connectionState="live"
          error={null}
          identifier="DEV-1"
          loading={false}
          onBack={jest.fn()}
          onOpenArtifact={onOpenArtifact}
          onOpenLog={onOpenLog}
          onRefresh={jest.fn()}
          records={[record]}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("DEV-1 evidence")).toBeTruthy();
    expect(screen.getByText("Session · Codex")).toBeTruthy();
    expect(screen.getByText("Requested gpt-5.6-sol · high")).toBeTruthy();
    expect(screen.getByText("Resolved gpt-5.6-sol · high")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Open session log" }));
    expect(onOpenLog).toHaveBeenCalledWith(record);

    fireEvent.press(screen.getByRole("button", { name: "Open Home" }));
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ path: "artifacts/home.png" }),
      record,
    );
  });

  it("renders an ordinary empty state without comparison language", () => {
    render(
      <ThemeProvider colorScheme="dark">
        <TaskEvidenceScreen
          cached={false}
          connectionState="live"
          error={null}
          identifier="DEV-2"
          loading={false}
          onBack={jest.fn()}
          onOpenArtifact={jest.fn()}
          onOpenLog={jest.fn()}
          onRefresh={jest.fn()}
          records={[]}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("No durable evidence is available yet.")).toBeTruthy();
    expect(screen.queryByText(/comparison/i)).toBeNull();
  });
});
