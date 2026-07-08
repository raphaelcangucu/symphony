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
  issueTerminalTabId,
} from "@/lib/workspaceTabs/types";
import {
  TerminalTabsApiUnavailableError,
  closeTerminalTab,
  createTerminalTab,
  listTerminalTabs,
} from "@/services/terminalTabs";

interface TerminalWorkspacePanelProps {
  projectSlug: string;
  issueIdentifier: string;
  variant?: "default" | "embedded";
  /** Extra controls appended to the tab bar (e.g. fullscreen toggle when docked). */
  trailingActions?: ReactNode;
}

export function TerminalWorkspacePanel({
  projectSlug,
  issueIdentifier,
  variant = "default",
  trailingActions = null,
}: TerminalWorkspacePanelProps) {
  const { t } = useTranslation();
  const [creatingTab, setCreatingTab] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(true);
  const [dynamicTabsEnabled, setDynamicTabsEnabled] = useState(true);

  const canonicalTabs = useMemo(
    () => [
      createIssueTerminalTab(issueIdentifier, t("workspace.terminal.issueShell")),
      createProjectTerminalTab(projectSlug, t("workspace.terminal.projectShell")),
    ],
    [issueIdentifier, projectSlug, t],
  );

  const { tabs, activeTabId, activeTab, selectTab, openTab, closeTab } = useWorkspaceTabs({
    scope: `issue-terminal:${issueIdentifier}`,
    projectSlug,
    canonicalTabs,
    defaultActiveTabId: issueTerminalTabId(issueIdentifier),
  });

  const loadDynamicTabs = useCallback(async () => {
    setLoadingTabs(true);
    try {
      const remoteTabs = await listTerminalTabs(projectSlug, issueIdentifier);
      setDynamicTabsEnabled(true);
      for (const remoteTab of remoteTabs) {
        openTab(createDynamicTerminalTab(remoteTab.id, issueIdentifier, remoteTab.title));
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
  }, [issueIdentifier, openTab, projectSlug, t]);

  useEffect(() => {
    void loadDynamicTabs();
  }, [loadDynamicTabs]);

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
    if (creatingTab || !dynamicTabsEnabled) return;
    setCreatingTab(true);
    try {
      const remoteTab = await createTerminalTab(projectSlug, issueIdentifier, {
        title: t("workspace.terminal.newTabTitle"),
      });
      const tab = createDynamicTerminalTab(remoteTab.id, issueIdentifier, remoteTab.title);
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
  }, [creatingTab, dynamicTabsEnabled, issueIdentifier, openTab, projectSlug, selectTab, t]);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((entry) => entry.id === tabId);
      if (!tab || tab.kind !== "dynamic-terminal") return;

      try {
        await closeTerminalTab(projectSlug, issueIdentifier, tab.tabId);
        closeTab(tabId);
      } catch (cause) {
        if (cause instanceof TerminalTabsApiUnavailableError) {
          closeTab(tabId);
          return;
        }
        toast.error(cause instanceof Error ? cause.message : t("workspace.terminal.closeTabFailed"));
      }
    },
    [closeTab, issueIdentifier, projectSlug, t, tabs],
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
          dynamicTabsEnabled || trailingActions ? (
            <>
              {dynamicTabsEnabled ? (
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

      <div className="min-h-0 flex-1 overflow-hidden">
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
