import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantMessageList, type LoadOlderControl } from "@/components/assistant/AssistantMessageList";
import { initTestI18n } from "@/i18n/testUtils";
import type { AssistantChatMessage } from "@/services/assistant";

function renderList(loadOlder: LoadOlderControl | null) {
  return render(
    <AssistantMessageList
      messages={[] as AssistantChatMessage[]}
      taskSnapshot={null}
      loadOlder={loadOlder}
      isRunning={false}
      runningStartedAt={null}
      activeToolDetail={null}
      connectionError={null}
      channelReady
      planApprovalMessageId={null}
      onInsertContext={vi.fn()}
      onApprovePlan={vi.fn()}
    />,
  );
}

describe("AssistantMessageList load-older control", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders no control when none is provided", () => {
    renderList(null);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the provided label and triggers onLoad on click", () => {
    const onLoad = vi.fn();
    renderList({ label: "↑ Load old prompts (3)", disabled: false, onLoad });

    const button = screen.getByRole("button", { name: "↑ Load old prompts (3)" });
    fireEvent.click(button);

    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("disables the control while loading", () => {
    const onLoad = vi.fn();
    renderList({ label: "Loading older messages…", disabled: true, onLoad });

    const button = screen.getByRole("button", { name: "Loading older messages…" });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onLoad).not.toHaveBeenCalled();
  });
});

describe("AssistantMessageList running activity", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  const runningMessage: AssistantChatMessage = {
    id: "assistant-1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "tool-1",
        name: "shell",
        status: "running",
        arguments: { command: "/bin/zsh -lc 'sleep 10'" },
        result: {},
      },
    ],
    metadata: {},
  };

  function renderRunning(messages: AssistantChatMessage[]) {
    return render(
      <AssistantMessageList
        messages={messages}
        taskSnapshot={null}
        isRunning
        runningStartedAt={Date.now()}
        activeToolDetail={{
          id: "tool-1",
          name: "shell",
          argumentsSummary: "/bin/zsh -lc 'sleep 10'",
        }}
        connectionError={null}
        channelReady
        planApprovalMessageId={null}
        onInsertContext={vi.fn()}
        onApprovePlan={vi.fn()}
      />,
    );
  }

  it("does not repeat a running tool already represented in the transcript", () => {
    renderRunning([runningMessage]);

    expect(screen.getAllByText("Running")).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the global fallback until the active tool reaches the transcript", () => {
    renderRunning([]);

    expect(screen.getByRole("status")).toHaveTextContent(
      /Running shell.*sleep 10/i,
    );
  });
});
