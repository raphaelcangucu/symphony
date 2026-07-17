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
  it("prefers the issue identifier for issue-linked tab titles", () => {
    expect(resolveIssueLinkedTabTitle("GAM-20", "Autonomous run")).toBe("GAM-20");
    expect(resolveIssueLinkedTabTitle(null, "Project chat")).toBe("Project chat");
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

  it("labels issue-linked tabs with the identifier and adds context in the tooltip", () => {
    const context = {
      threadIssueIdentifiers: new Map([[42, "GAM-20"]]),
      issueTitles: new Map([["GAM-20", "Fix login race"]]),
    };

    const presentation = resolveWorkspaceTabPresentation(
      createAssistantSessionTab(42, "Autonomous run"),
      context,
    );

    expect(presentation.label).toBe("GAM-20");
    expect(presentation.tooltip).toBe("GAM-20 · Fix login race · Autonomous run");
    expect(getIssueIdentifierForTab(createAuthoringSessionTab("DEMO-1", "Saved work"), context)).toBe("DEMO-1");
  });

  it("keeps non-issue tabs unchanged", () => {
    const context = {
      threadIssueIdentifiers: new Map<number, string>(),
      issueTitles: new Map<string, string>(),
    };

    expect(resolveWorkspaceTabPresentation(createSessionsListTab("Workspaces"), context)).toEqual({
      label: "Workspaces",
    });
  });
});
