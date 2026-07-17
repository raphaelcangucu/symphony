import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { AssistantMessageList } from "@/components/assistant/AssistantMessageList";
import { initTestI18n } from "@/i18n/testUtils";
import type { SessionLogFeedItem } from "@/lib/sessionLogFeed";

describe("AssistantMessageList session-log feed", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("renders message, disclosure, and event_group variants", () => {
    const feedItems: SessionLogFeedItem[] = [
      {
        type: "message",
        id: "m1",
        message: {
          id: "m1",
          role: "assistant",
          content: "Hello from the log",
          toolCalls: [],
          metadata: { source: "session_log" },
        },
      },
      {
        type: "disclosure",
        id: "d1",
        kind: "reasoning",
        title: "Thinking",
        body: "internal notes",
        language: "text",
        collapsed: true,
        status: null,
      },
      {
        type: "event_group",
        id: "g1",
        entries: [
          {
            id: "e1",
            title: "Token Count",
            body: "42",
            language: "text",
            collapsed: true,
            status: null,
          },
        ],
      },
    ];

    render(
      <AssistantMessageList
        feedItems={feedItems}
        taskSnapshot={null}
        isRunning={false}
        runningStartedAt={null}
        activeToolDetail={null}
        connectionError={null}
        channelReady
        planApprovalMessageId={null}
        onInsertContext={() => undefined}
        onApprovePlan={() => undefined}
      />,
    );

    expect(screen.getByText("Hello from the log")).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByTestId("session-event-group")).toBeInTheDocument();
  });
});
