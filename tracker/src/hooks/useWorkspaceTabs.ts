import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

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
  // Tracks which storage key the in-memory state currently belongs to. Prevents
  // writing project A's tabs into project B's key during a project switch.
  const stateStorageKeyRef = useRef(storageKey);

  const [state, dispatch] = useReducer(
    workspaceTabsReducer,
    { storageKey, canonicalTabs, defaultActiveTabId, persist },
    ({ storageKey: key, canonicalTabs: tabs, defaultActiveTabId: activeId, persist: shouldPersist }) =>
      buildInitialState(key, tabs, activeId, shouldPersist),
  );

  useEffect(() => {
    const next = buildInitialState(storageKey, canonicalTabs, defaultActiveTabId, persist);
    stateStorageKeyRef.current = storageKey;
    dispatch({ type: "restore", state: next });
    // Reload persisted tabs when the storage scope changes (project switch) or
    // when canonical tab ids change (e.g. issue terminal switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canonicalTabs tracked via canonicalSignature
  }, [storageKey, canonicalSignature, defaultActiveTabId, persist]);

  useEffect(() => {
    if (!persist) return;
    // Intentionally omit `storageKey` from deps: a key change must restore first
    // and only persist after `state` updates to the restored tabs. Writing on
    // storageKey change alone would copy the previous project's open tabs into
    // the newly selected project's localStorage entry.
    if (stateStorageKeyRef.current !== storageKey) return;
    writePersistedWorkspaceTabs(storageKey, state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only when state changes
  }, [persist, state]);

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
