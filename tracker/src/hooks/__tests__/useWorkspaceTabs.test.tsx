import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import {
  readPersistedWorkspaceTabs,
  workspaceTabsStorageKey,
  writePersistedWorkspaceTabs,
} from "@/lib/workspaceTabs/persistence";
import {
  createAssistantSessionTab,
  createSessionsListTab,
  SESSIONS_LIST_TAB_ID,
} from "@/lib/workspaceTabs/types";

describe("useWorkspaceTabs", () => {
  const scope = "project-sessions";
  const listTab = createSessionsListTab("Workspaces");

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reloads persisted tabs when projectSlug changes", () => {
    writePersistedWorkspaceTabs(workspaceTabsStorageKey(scope, "advising"), {
      tabs: [listTab, createAssistantSessionTab(100, "Advising chat")],
      activeTabId: "assistant-session:100",
    });
    writePersistedWorkspaceTabs(workspaceTabsStorageKey(scope, "macro-markets"), {
      tabs: [listTab, createAssistantSessionTab(8051, "Macro chat")],
      activeTabId: "assistant-session:8051",
    });

    const { result, rerender } = renderHook(
      ({ projectSlug }: { projectSlug: string }) =>
        useWorkspaceTabs({
          scope,
          projectSlug,
          canonicalTabs: [listTab],
          defaultActiveTabId: SESSIONS_LIST_TAB_ID,
        }),
      { initialProps: { projectSlug: "advising" } },
    );

    expect(result.current.tabs.some((tab) => tab.title === "Advising chat")).toBe(true);
    expect(result.current.tabs.some((tab) => tab.title === "Macro chat")).toBe(false);

    rerender({ projectSlug: "macro-markets" });

    expect(result.current.tabs.some((tab) => tab.title === "Advising chat")).toBe(false);
    expect(result.current.tabs.some((tab) => tab.title === "Macro chat")).toBe(true);
  });

  it("persists open tabs per project scope", () => {
    const { result } = renderHook(() =>
      useWorkspaceTabs({
        scope,
        projectSlug: "macro-markets",
        canonicalTabs: [listTab],
        defaultActiveTabId: SESSIONS_LIST_TAB_ID,
      }),
    );

    act(() => {
      result.current.openTab(createAssistantSessionTab(8051, "Macro chat"));
    });

    const persisted = readPersistedWorkspaceTabs(workspaceTabsStorageKey(scope, "macro-markets"));
    expect(persisted?.tabs.some((tab) => tab.title === "Macro chat")).toBe(true);
  });

  it("does not write the previous project's tabs into the next project's storage key", () => {
    writePersistedWorkspaceTabs(workspaceTabsStorageKey(scope, "macro-markets"), {
      tabs: [listTab, createAssistantSessionTab(8051, "Macro chat")],
      activeTabId: "assistant-session:8051",
    });

    const { result, rerender } = renderHook(
      ({ projectSlug }: { projectSlug: string }) =>
        useWorkspaceTabs({
          scope,
          projectSlug,
          canonicalTabs: [listTab],
          defaultActiveTabId: SESSIONS_LIST_TAB_ID,
        }),
      { initialProps: { projectSlug: "advising" } },
    );

    act(() => {
      result.current.openTab(createAssistantSessionTab(100, "Advising chat"));
    });

    rerender({ projectSlug: "macro-markets" });

    const persisted = readPersistedWorkspaceTabs(workspaceTabsStorageKey(scope, "macro-markets"));
    expect(persisted?.tabs.some((tab) => tab.title === "Advising chat")).toBe(false);
    expect(persisted?.tabs.some((tab) => tab.title === "Macro chat")).toBe(true);
    expect(result.current.tabs.some((tab) => tab.title === "Advising chat")).toBe(false);
  });
});
