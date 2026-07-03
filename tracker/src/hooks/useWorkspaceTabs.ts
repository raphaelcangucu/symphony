import { useCallback, useEffect, useMemo, useReducer } from "react";

import { createWorkspaceTabsState, workspaceTabsReducer } from "@/lib/workspaceTabs/reducer";
import { readPersistedWorkspaceTabs, writePersistedWorkspaceTabs, workspaceTabsStorageKey } from "@/lib/workspaceTabs/persistence";
import type { WorkspaceTab, WorkspaceTabsState } from "@/lib/workspaceTabs/types";

interface UseWorkspaceTabsArgs {
  scope: string;
  projectSlug: string;
  canonicalTabs: WorkspaceTab[];
  defaultActiveTabId?: string;
  persist?: boolean;
}

interface UseWorkspaceTabsResult {
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeTab: WorkspaceTab | null;
  selectTab: (tabId: string) => void;
  openTab: (tab: WorkspaceTab) => void;
  closeTab: (tabId: string) => void;
}

function mergeCanonicalTabs(
  canonicalTabs: WorkspaceTab[],
  previous: WorkspaceTabsState,
  defaultActiveTabId?: string,
): WorkspaceTabsState {
  const closableTabs = previous.tabs.filter((tab) => tab.closable);
  const mergedTabs = [...canonicalTabs];

  for (const tab of closableTabs) {
    if (mergedTabs.some((entry) => entry.id === tab.id)) continue;
    mergedTabs.push(tab);
  }

  const preferredActiveTabId =
    previous.activeTabId && mergedTabs.some((tab) => tab.id === previous.activeTabId)
      ? previous.activeTabId
      : defaultActiveTabId ?? canonicalTabs[0]?.id ?? mergedTabs[0]?.id ?? "";

  return createWorkspaceTabsState(mergedTabs, preferredActiveTabId);
}

function buildInitialState(
  storageKey: string,
  canonicalTabs: WorkspaceTab[],
  defaultActiveTabId: string | undefined,
  persist: boolean,
): WorkspaceTabsState {
  const fallback = createWorkspaceTabsState(canonicalTabs, defaultActiveTabId);
  if (!persist) return fallback;

  const restored = readPersistedWorkspaceTabs(storageKey);
  if (!restored) return fallback;

  return mergeCanonicalTabs(canonicalTabs, restored, defaultActiveTabId);
}

export function useWorkspaceTabs({
  scope,
  projectSlug,
  canonicalTabs,
  defaultActiveTabId,
  persist = true,
}: UseWorkspaceTabsArgs): UseWorkspaceTabsResult {
  const storageKey = useMemo(() => workspaceTabsStorageKey(scope, projectSlug), [projectSlug, scope]);
  const canonicalSignature = useMemo(() => canonicalTabs.map((tab) => tab.id).join("|"), [canonicalTabs]);

  const [state, dispatch] = useReducer(
    workspaceTabsReducer,
    { storageKey, canonicalTabs, defaultActiveTabId, persist },
    ({ storageKey: key, canonicalTabs: tabs, defaultActiveTabId: activeId, persist: shouldPersist }) =>
      buildInitialState(key, tabs, activeId, shouldPersist),
  );

  useEffect(() => {
    dispatch({
      type: "restore",
      state: mergeCanonicalTabs(canonicalTabs, state, defaultActiveTabId),
    });
    // Reconcile canonical tabs when their identity changes (e.g. issue switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by canonicalSignature only
  }, [canonicalSignature, defaultActiveTabId]);

  useEffect(() => {
    if (!persist) return;
    writePersistedWorkspaceTabs(storageKey, state);
  }, [persist, state, storageKey]);

  const selectTab = useCallback((tabId: string) => {
    dispatch({ type: "select", tabId });
  }, []);

  const openTab = useCallback((tab: WorkspaceTab) => {
    dispatch({ type: "open", tab });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    dispatch({ type: "close", tabId });
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null,
    [state.activeTabId, state.tabs],
  );

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeTab,
    selectTab,
    openTab,
    closeTab,
  };
}
