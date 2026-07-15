import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantMessageList, type LoadOlderControl } from "@/components/assistant/AssistantMessageList";
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
