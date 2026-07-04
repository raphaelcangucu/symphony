import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TerminalTabContent } from "@/components/terminal/TerminalTabContent";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { Button } from "@/components/ui/button";
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs";
import { PROJECT_TERMINAL_SCOPE } from "@/lib/terminalScopes";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import {
  createDynamicTerminalTab,
  createProjectTerminalTab,
  projectTerminalTabId,
} from "@/lib/workspaceTabs/types";
import {
  TerminalTabsApiUnavailableError,
  closeTerminalTab,
  createTerminalTab,
  listTerminalTabs,
} from "@/services/terminalTabs";

interface ProjectTerminalWorkspaceProps {
  projectSlug: string;
}

export function ProjectTerminalWorkspace({ projectSlug }: ProjectTerminalWorkspaceProps) {
  const { t } = useTranslation();
  const [creatingTab, setCreatingTab] = useState(false);
  const [loadingTabs, setLoadingTabs] = useState(true);
  const [dynamicTabsEnabled, setDynamicTabsEnabled] = useState(true);

  const canonicalTabs = useMemo(
    () => [createProjectTerminalTab(projectSlug, t("workspace.terminal.projectShell"))],
    [projectSlug, t],
  );

  const { tabs, activeTabId, activeTab, selectTab, openTab, closeTab } = useWorkspaceTabs({
    scope: `project-terminal:${projectSlug}`,
    projectSlug,
    canonicalTabs,
    defaultActiveTabId: projectTerminalTabId(projectSlug),
  });

  const loadDynamicTabs = useCallback(async () => {
    setLoadingTabs(true);
    try {
      const remoteTabs = await listTerminalTabs(projectSlug, PROJECT_TERMINAL_SCOPE);
      setDynamicTabsEnabled(true);
      for (const remoteTab of remoteTabs) {
        openTab(createDynamicTerminalTab(remoteTab.id, PROJECT_TERMINAL_SCOPE, remoteTab.title));
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
  }, [openTab, projectSlug, t]);

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
      const remoteTab = await createTerminalTab(projectSlug, PROJECT_TERMINAL_SCOPE, {
        title: t("workspace.terminal.newTabTitle"),
      });
      const tab = createDynamicTerminalTab(remoteTab.id, PROJECT_TERMINAL_SCOPE, remoteTab.title);
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
  }, [creatingTab, dynamicTabsEnabled, openTab, projectSlug, selectTab, t]);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((entry) => entry.id === tabId);
      if (!tab || tab.kind !== "dynamic-terminal") return;

      try {
        await closeTerminalTab(projectSlug, PROJECT_TERMINAL_SCOPE, tab.tabId);
        closeTab(tabId);
      } catch (cause) {
        if (cause instanceof TerminalTabsApiUnavailableError) {
          closeTab(tabId);
          return;
        }
        toast.error(cause instanceof Error ? cause.message : t("workspace.terminal.closeTabFailed"));
      }
    },
    [closeTab, projectSlug, t, tabs],
  );

  return (
    <main className="box-border flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-gradient-to-br from-muted/40 via-background to-muted/20 p-3 sm:p-4">
      <section className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,96rem)] flex-col gap-2.5 overflow-hidden">
        <header className="shrink-0 rounded-lg border border-border/60 bg-card/90 px-4 py-2.5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("workspace.terminal.projectDockEyebrow")}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{t("workspace.terminal.projectDockTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("workspace.terminal.projectDockDescription")}</p>
        </header>

        <WorkspaceTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={selectTab}
          onClose={(tabId) => void handleCloseTab(tabId)}
          ariaLabel={t("workspace.terminal.tabsAria")}
          shortcutHints
          trailing={
            dynamicTabsEnabled ? (
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
            ) : null
          }
        />

        <section
          className={cn(
            "min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-[#0b1220] shadow-sm",
            SCROLLBAR_THIN,
          )}
        >
          <TerminalTabContent
            activeTab={activeTab}
            activeTabId={activeTabId}
            projectSlug={projectSlug}
            t={t}
          />
        </section>
      </section>
    </main>
  );
}
