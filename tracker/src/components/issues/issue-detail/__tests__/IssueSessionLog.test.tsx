import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IssueSessionLog } from "@/components/issues/issue-detail/IssueSessionLog";
import { renderWithI18n } from "@/i18n/testUtils";
import type { SessionLogEntry } from "@/types/session-log";

function entry(partial: Partial<SessionLogEntry> & Pick<SessionLogEntry, "kind" | "title">): SessionLogEntry {
  return {
    body: null,
    language: "text",
    status: null,
    collapsed: false,
    callId: null,
    ...partial,
  };
}

const entries: SessionLogEntry[] = [
  entry({ kind: "assistant", title: "Codex", body: "Starting", language: "markdown" }),
  entry({
    kind: "tool_call",
    title: "update_plan",
    body: JSON.stringify({
      plan: [
        { step: "Write tests", status: "in_progress" },
        { step: "Ship", status: "pending" },
      ],
    }),
    language: "json",
    callId: "call_1",
  }),
];

describe("IssueSessionLog tasks", () => {
  it("renders the pinned task panel above the transcript", () => {
    renderWithI18n(<IssueSessionLog issueIdentifier="ABC-1" connected entries={entries} error={null} />);
    expect(screen.getByLabelText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("0/2 done")).toBeInTheDocument();
  });

  it("renders an inline task marker instead of a raw tool-call block", () => {
    renderWithI18n(<IssueSessionLog issueIdentifier="ABC-1" connected entries={entries} error={null} />);
    expect(screen.getByText("Plan · 0/2 done")).toBeInTheDocument();
  });

  it("renders no panel when there are no task tools", () => {
    const plain = [entry({ kind: "tool_call", title: "Bash", body: JSON.stringify({ cmd: "ls" }), callId: "c" })];
    renderWithI18n(<IssueSessionLog issueIdentifier="ABC-1" connected entries={plain} error={null} />);
    expect(screen.queryByLabelText("Tasks")).not.toBeInTheDocument();
  });
});
