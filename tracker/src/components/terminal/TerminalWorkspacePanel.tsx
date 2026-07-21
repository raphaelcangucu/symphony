import { Plus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TerminalTabContent } from "@/components/terminal/TerminalTabContent";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { Button } from "@/components/ui/button";
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import {
  createDynamicTerminalTab,
  createIssueTerminalTab,
  createProjectTerminalTab,
  createThreadTerminalTab,
  issueTerminalTabId,
  threadTerminalTabId,
} from "@/lib/workspaceTabs/types";
import {
  TerminalTabsApiUnavailableError,
  closeTerminalTab,
  createTerminalTab,
  listTerminalTabs,
} from "@/services/terminalTabs";

interface TerminalWorkspacePanelBaseProps {
  projectSlug: string;
  variant?: "default" | "embedded";
  /** Extra controls appended to the tab bar (e.g. fullscreen toggle when docked). */
  trailingActions?: ReactNode;
}

type TerminalWorkspacePanelProps = TerminalWorkspacePanelBaseProps &
  (
    | { issueIdentifier: string; threadId?: never }
    | { issueIdentifier?: never; threadId: number }
  );

export function TerminalWorkspacePanel({
  projectSlug,
  issueIdentifier,
  threadId,
  variant = "default",
  trailingActions = null,
}: TerminalWorkspacePanelProps) {
  const { t } = useTranslation();
  const normalizedIssueIdentifier = issueIdentifier?.trim() ?? "";
  const normalizedThreadId =
    typeof threadId === "number" && Number.isInteger(threadId) && threadId > 0
      ? threadId
      : null;
  const issueMode = normalizedIssueIdentifier.length > 0;
  const threadMode = normalizedThreadId !== null;

  if (issueMode === threadMode) {
    throw new Error("TerminalWorkspacePanel requires exactly one valid issueIdentifier or threadId");
  }

  const [creatingTab, setCreatingTab] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(issueMode);
  const [dynamicTabsEnabled, setDynamicTabsEnabled] = useState(issueMode);

  const canonicalTabs = useMemo(
    () =>
      normalizedThreadId !== null
        ? [
            createThreadTerminalTab(
              normalizedThreadId,
              t("workspace.terminal.threadShell"),
            ),
          ]
        : [
            createIssueTerminalTab(
              normalizedIssueIdentifier,
              t("workspace.terminal.issueShell"),
            ),
            createProjectTerminalTab(projectSlug, t("workspace.terminal.projectShell")),
          ],
    [
      normalizedIssueIdentifier,
      normalizedThreadId,
      projectSlug,
      t,
    ],
  );

  const { tabs, activeTabId, activeTab, selectTab, openTab, closeTab } = useWorkspaceTabs({
    scope: threadMode
      ? `thread-terminal:${normalizedThreadId}`
      : `issue-terminal:${normalizedIssueIdentifier}`,
    projectSlug,
    canonicalTabs,
    defaultActiveTabId: normalizedThreadId !== null
      ? threadTerminalTabId(normalizedThreadId)
      : issueTerminalTabId(normalizedIssueIdentifier),
  });

  const loadDynamicTabs = useCallback(async () => {
    if (!issueMode) return;

    setLoadingTabs(true);
    try {
      const remoteTabs = await listTerminalTabs(projectSlug, normalizedIssueIdentifier);
      setDynamicTabsEnabled(true);
      for (const remoteTab of remoteTabs) {
        openTab(
          createDynamicTerminalTab(
            remoteTab.id,
            normalizedIssueIdentifier,
            remoteTab.title,
          ),
        );
      }
    } catch (cause) {
      if (cause instanceof TerminalTabsApiUnavailableError) {
        setDynamicTabsEnabled(false);
        return;
      }
      toast.error(cause instanceof Error ? cause.message : t("workspace.terminal.loadTabsFailed"));
    } finally {
      setLoadingTabs(false);
    }
  }, [issueMode, normalizedIssueIdentifier, openTab, projectSlug, t]);

  useEffect(() => {
    if (!issueMode) return;
    void loadDynamicTabs();
  }, [issueMode, loadDynamicTabs]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const index = Number(event.key) - 1;
      if (index < 0 || index >= tabs.length) return;
      event.preventDefault();
      const tab = tabs[index];
      if (tab) selectTab(tab.id);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectTab, tabs]);

  const handleCreateTab = useCallback(async () => {
    if (!issueMode || creatingTab || !dynamicTabsEnabled) return;
    setCreatingTab(true);
    try {
      const remoteTab = await createTerminalTab(projectSlug, normalizedIssueIdentifier, {
        title: t("workspace.terminal.newTabTitle"),
      });
      const tab = createDynamicTerminalTab(
        remoteTab.id,
        normalizedIssueIdentifier,
        remoteTab.title,
      );
      openTab(tab);
      selectTab(tab.id);
    } catch (cause) {
      if (cause instanceof TerminalTabsApiUnavailableError) {
        setDynamicTabsEnabled(false);
        toast.message(t("workspace.terminal.dynamicTabsUnavailable"));
        return;
      }
      toast.error(cause instanceof Error ? cause.message : t("workspace.terminal.createTabFailed"));
    } finally {
      setCreatingTab(false);
    }
  }, [
    creatingTab,
    dynamicTabsEnabled,
    issueMode,
    normalizedIssueIdentifier,
    openTab,
    projectSlug,
    selectTab,
    t,
  ]);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((entry) => entry.id === tabId);
      if (!tab || tab.kind !== "dynamic-terminal") return;

      try {
        await closeTerminalTab(projectSlug, normalizedIssueIdentifier, tab.tabId);
        closeTab(tabId);
      } catch (cause) {
        if (cause instanceof TerminalTabsApiUnavailableError) {
          closeTab(tabId);
          return;
        }
        toast.error(cause instanceof Error ? cause.message : t("workspace.terminal.closeTabFailed"));
      }
    },
    [closeTab, normalizedIssueIdentifier, projectSlug, t, tabs],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {variant === "default" ? (
        <div className="shrink-0 space-y-0.5">
          <h3 className="text-sm font-medium">{t("workspace.terminal.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("workspace.terminal.description")}</p>
        </div>
      ) : null}

      <WorkspaceTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={selectTab}
        onClose={(tabId) => void handleCloseTab(tabId)}
        ariaLabel={t("workspace.terminal.tabsAria")}
        shortcutHints
        trailing={
          (issueMode && dynamicTabsEnabled) || trailingActions ? (
            <>
              {issueMode && dynamicTabsEnabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={creatingTab || loadingTabs}
                  onClick={() => void handleCreateTab()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {creatingTab ? t("workspace.terminal.creatingTab") : t("workspace.terminal.newTab")}
                </Button>
              ) : null}
              {trailingActions}
            </>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TerminalTabContent
          activeTab={activeTab}
          activeTabId={activeTabId}
          projectSlug={projectSlug}
          t={t}
        />
      </div>
    </section>
  );
}
