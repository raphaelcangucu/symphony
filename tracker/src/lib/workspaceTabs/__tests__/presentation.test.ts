import { describe, expect, it } from "vitest";

import {
  getIssueIdentifierForTab,
  promoteSelectedSidebarSession,
  resolveIssueLinkedTabTitle,
  resolveSidebarSessionPresentation,
  resolveWorkspaceTabPresentation,
} from "@/lib/workspaceTabs/presentation";
import {
  createAssistantSessionTab,
  createAuthoringSessionTab,
  createSessionsListTab,
} from "@/lib/workspaceTabs/types";

describe("workspace tab presentation", () => {
  it("prefers the session title for issue-linked tab titles", () => {
    expect(resolveIssueLinkedTabTitle("GAM-20", "Chat · GAM-20 · Fix login")).toBe(
      "Chat · GAM-20 · Fix login",
    );
    expect(resolveIssueLinkedTabTitle(null, "Project chat")).toBe("Project chat");
    expect(resolveIssueLinkedTabTitle("GAM-20", "")).toBe("GAM-20");
  });

  it("labels sidebar issue sessions as code - title on one line", () => {
    expect(resolveSidebarSessionPresentation("Models Game Back", "GAM-20")).toBe(
      "GAM-20 - Models Game Back",
    );
    expect(resolveSidebarSessionPresentation("GAM-20", "GAM-20")).toBe("GAM-20");
    expect(resolveSidebarSessionPresentation("Project chat", null)).toBe("Project chat");
  });

  it("promotes the selected sidebar session ahead of older rows", () => {
    const sessions = [{ id: "thread:1" }, { id: "thread:99" }, { id: "thread:2" }];
    expect(promoteSelectedSidebarSession(sessions, "thread:99").map((session) => session.id)).toEqual([
      "thread:99",
      "thread:1",
      "thread:2",
    ]);
  });

  it("labels issue-linked tabs with the session title", () => {
    const context = {
      threadIssueIdentifiers: new Map([[42, "GAM-20"]]),
      issueTitles: new Map([["GAM-20", "Fix login race"]]),
      threadStatusIcons: new Map([
        [
          42,
          {
            sessionKind: "chat" as const,
            statusKind: "idle" as const,
            aggregateStatus: "idle" as const,
            needsAttention: false,
          },
        ],
      ]),
    };

    const presentation = resolveWorkspaceTabPresentation(
      createAssistantSessionTab(42, "Chat · GAM-20 · Fix login race"),
      context,
    );

    expect(presentation.label).toBe("Chat · GAM-20 · Fix login race");
    expect(presentation.tooltip).toBeUndefined();
    expect(presentation.statusIcon).toEqual({
      sessionKind: "chat",
      statusKind: "idle",
      aggregateStatus: "idle",
      needsAttention: false,
    });
    expect(getIssueIdentifierForTab(createAuthoringSessionTab("DEMO-1", "Saved work"), context)).toBe(
      "DEMO-1",
    );
  });

  it("keeps non-issue tabs unchanged", () => {
    const context = {
      threadIssueIdentifiers: new Map<number, string>(),
      issueTitles: new Map<string, string>(),
    };

    expect(resolveWorkspaceTabPresentation(createSessionsListTab("Workspaces"), context)).toEqual({
      label: "Workspaces",
      statusIcon: null,
    });
  });
});
