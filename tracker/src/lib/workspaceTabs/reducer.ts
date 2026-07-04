import type { WorkspaceTab, WorkspaceTabsState } from "./types";

export type WorkspaceTabsAction =
  | { type: "select"; tabId: string }
  | { type: "open"; tab: WorkspaceTab }
  | { type: "close"; tabId: string }
  | { type: "restore"; state: WorkspaceTabsState };

function findTabIndex(tabs: WorkspaceTab[], tabId: string): number {
  return tabs.findIndex((tab) => tab.id === tabId);
}

function resolveActiveTabId(tabs: WorkspaceTab[], preferredTabId: string): string {
  if (tabs.length === 0) return "";
  if (findTabIndex(tabs, preferredTabId) >= 0) return preferredTabId;
  return tabs[0]?.id ?? "";
}

export function workspaceTabsReducer(state: WorkspaceTabsState, action: WorkspaceTabsAction): WorkspaceTabsState {
  switch (action.type) {
    case "select": {
      if (!action.tabId.trim()) return state;
      if (findTabIndex(state.tabs, action.tabId) < 0) return state;
      if (state.activeTabId === action.tabId) return state;
      return { ...state, activeTabId: action.tabId };
    }

    case "open": {
      const tab = action.tab;
      if (!tab.id.trim()) return state;

      const existingIndex = findTabIndex(state.tabs, tab.id);
      if (existingIndex >= 0) {
        const nextTabs = state.tabs.slice();
        nextTabs[existingIndex] = { ...nextTabs[existingIndex], ...tab, closable: nextTabs[existingIndex]?.closable ?? tab.closable };
        return { tabs: nextTabs, activeTabId: tab.id };
      }

      return {
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      };
    }

    case "close": {
      const tab = state.tabs.find((entry) => entry.id === action.tabId);
      if (!tab || !tab.closable) return state;

      const nextTabs = state.tabs.filter((entry) => entry.id !== action.tabId);
      if (nextTabs.length === 0) {
        return { tabs: [], activeTabId: "" };
      }

      const nextActiveTabId =
        state.activeTabId === action.tabId
          ? resolveActiveTabId(nextTabs, nextTabs[nextTabs.length - 1]?.id ?? "")
          : state.activeTabId;

      return { tabs: nextTabs, activeTabId: nextActiveTabId };
    }

    case "restore": {
      const tabs = action.state.tabs.filter((tab) => tab.id.trim().length > 0);
      const activeTabId = resolveActiveTabId(tabs, action.state.activeTabId);
      return { tabs, activeTabId };
    }

    default:
      return state;
  }
}

export function createWorkspaceTabsState(tabs: WorkspaceTab[], activeTabId?: string): WorkspaceTabsState {
  const normalizedTabs = tabs.filter((tab) => tab.id.trim().length > 0);
  return {
    tabs: normalizedTabs,
    activeTabId: resolveActiveTabId(normalizedTabs, activeTabId ?? normalizedTabs[0]?.id ?? ""),
  };
}
