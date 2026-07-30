import { fireEvent, render, screen } from "@testing-library/react-native";

import type { AssistantThread } from "@/api/contracts";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { IssueSessionsTab } from "./IssueSessionsTab";

const threads: AssistantThread[] = [
  {
    id: 42,
    scope: "issue_execution",
    projectSlug: "symphony",
    projectName: "Symphony",
    issueIdentifier: "MOB-7",
    workspacePath: "/tmp/mob-7",
    title: "Execution MOB-7",
    status: "completed",
    preview: "Implementation completed",
    updatedAt: "2026-07-29T16:30:00Z",
    agentKind: "codex",
    needsReview: false,
  },
  {
    id: 43,
    scope: "issue_session",
    projectSlug: "symphony",
    projectName: "Symphony",
    issueIdentifier: "MOB-7",
    workspacePath: "/tmp/mob-7",
    title: "Review evidence",
    status: "active",
    preview: "Check the mobile screenshots",
    updatedAt: "2026-07-29T16:35:00Z",
    agentKind: "codex",
    needsReview: false,
  },
];

describe("IssueSessionsTab", () => {
  it("shows execution first and opens existing or new task sessions", () => {
    const onOpen = jest.fn();
    const onCreate = jest.fn();
    render(
      <ThemeProvider colorScheme="dark">
        <IssueSessionsTab loading={false} onCreate={onCreate} onOpen={onOpen} threads={threads} />
      </ThemeProvider>,
    );

    expect(screen.getAllByRole("button")[1].props.accessibilityLabel).toBe("Open session 42");
    fireEvent.press(screen.getByRole("button", { name: "Open session 43" }));
    fireEvent.press(screen.getByRole("button", { name: "New task session" }));
    expect(onOpen).toHaveBeenCalledWith(threads[1]);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
