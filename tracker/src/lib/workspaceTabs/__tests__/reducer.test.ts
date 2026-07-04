import { describe, expect, it } from "vitest";

import { createWorkspaceTabsState, workspaceTabsReducer } from "@/lib/workspaceTabs/reducer";
import {
  createAssistantSessionTab,
  createIssueTerminalTab,
  createProjectTerminalTab,
  createSessionsListTab,
} from "@/lib/workspaceTabs/types";

describe("workspaceTabsReducer", () => {
  const issueTab = createIssueTerminalTab("MAC-1", "Issue");
  const projectTab = createProjectTerminalTab("demo", "Project");
  const listTab = createSessionsListTab("Sessions");
  const assistantTab = createAssistantSessionTab(42, "Planning");

  it("opens a tab and selects it", () => {
    const initial = createWorkspaceTabsState([listTab], listTab.id);
    const next = workspaceTabsReducer(initial, { type: "open", tab: assistantTab });

    expect(next.tabs).toHaveLength(2);
    expect(next.activeTabId).toBe(assistantTab.id);
  });

  it("reopens an existing tab without duplicating it", () => {
    const initial = createWorkspaceTabsState([listTab, assistantTab], listTab.id);
    const renamed = createAssistantSessionTab(42, "Updated title");
    const next = workspaceTabsReducer(initial, { type: "open", tab: renamed });

    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[1]?.title).toBe("Updated title");
    expect(next.activeTabId).toBe(assistantTab.id);
  });

  it("prevents closing canonical tabs", () => {
    const initial = createWorkspaceTabsState([issueTab, projectTab], issueTab.id);
    const next = workspaceTabsReducer(initial, { type: "close", tabId: issueTab.id });
    expect(next).toEqual(initial);
  });

  it("closes closable tabs and selects the previous tab", () => {
    const initial = createWorkspaceTabsState([listTab, assistantTab], assistantTab.id);
    const next = workspaceTabsReducer(initial, { type: "close", tabId: assistantTab.id });

    expect(next.tabs).toEqual([listTab]);
    expect(next.activeTabId).toBe(listTab.id);
  });

  it("ignores invalid select requests", () => {
    const initial = createWorkspaceTabsState([listTab], listTab.id);
    const next = workspaceTabsReducer(initial, { type: "select", tabId: "missing" });
    expect(next).toEqual(initial);
  });
});
