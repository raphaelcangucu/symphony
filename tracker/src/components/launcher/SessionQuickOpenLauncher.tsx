import { GitBranch, GitPullRequest, Zap, CircleDot, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import {
  investigateLauncherItem,
  openLauncherPreviewNavigation,
  openLauncherSession,
  resolveInvestigateTemplate,
  stackStandaloneLauncherItem,
} from "@/components/launcher/launcherActions";
import { LauncherItemRow } from "@/components/launcher/LauncherItemRow";
import { LauncherPreviewDialog, type LauncherPreviewTarget } from "@/components/launcher/LauncherPreviewDialog";
import { filterLauncherItems, LAUNCHER_TABS, QUICK_ACTIONS } from "@/components/launcher/launcherSources";
import { useLauncherData, type LauncherDataItem } from "@/components/launcher/useLauncherData";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { viewFromPathname } from "@/lib/workspaceRoutes";
import type { LauncherTabId } from "@/types/launcher";

const TAB_ICON: Record<LauncherTabId, LucideIcon> = {
  actions: Zap,
  issues: CircleDot,
  prs: GitPullRequest,
  branches: GitBranch,
};

function stackBranchName(item: LauncherDataItem, tab: LauncherTabId): string {
  if (tab === "branches") return item.branchName ?? item.id;
  return item.branchName ?? item.id;
}

function rowActionsForItem(
  item: LauncherDataItem,
  tab: LauncherTabId,
): { showPreview: boolean; showInvestigate: boolean; showStack: boolean } {
  if (tab === "actions") {
    return { showPreview: false, showInvestigate: false, showStack: false };
  }
  if (tab === "issues") {
    return { showPreview: true, showInvestigate: Boolean(item.issueIdentifier), showStack: false };
  }
  if (tab === "prs") {
    return {
      showPreview: true,
      showInvestigate: Boolean(item.issueIdentifier),
      showStack: !item.issueIdentifier,
    };
  }
  return { showPreview: false, showInvestigate: false, showStack: !item.issueIdentifier };
}

export function SessionQuickOpenLauncher() {
  const { t } = useTranslation();
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const view = viewFromPathname(location.pathname);

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<LauncherTabId>("issues");
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState("");
  const [previewTarget, setPreviewTarget] = useState<LauncherPreviewTarget | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const { items, loading } = useLauncherData({ projectSlug, open, activeTab, query: debouncedQuery });

  const actionItems = useMemo<LauncherDataItem[]>(
    () =>
      QUICK_ACTIONS.map((action) => ({
        kind: "actions",
        id: action.id,
        title: t(action.labelKey),
        searchTokens: [t(action.labelKey), action.id],
      })),
    [t],
  );

  const visible = useMemo(() => {
    const source = activeTab === "actions" ? actionItems : items;
    return filterLauncherItems(source, query);
  }, [activeTab, actionItems, items, query]);

  useEffect(() => {
    setHighlightedId(visible[0]?.id ?? "");
  }, [activeTab, visible]);

  const highlightedItem = useMemo(
    () => visible.find((item) => item.id === highlightedId) ?? visible[0] ?? null,
    [highlightedId, visible],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const openSession = useCallback(
    async (item: LauncherDataItem, background: boolean) => {
      if (!item.issueIdentifier) {
        if (item.externalUrl) {
          window.open(item.externalUrl, "_blank", "noopener");
          return;
        }
        toast.message(t("launcher.toast.noLinkedIssue"));
        return;
      }
      await openLauncherSession({
        projectSlug,
        issueIdentifier: item.issueIdentifier,
        background,
        view,
        navigate,
        t,
      });
    },
    [navigate, projectSlug, t, view],
  );

  const onSelect = useCallback(
    (item: LauncherDataItem, background: boolean) => {
      close();

      if (activeTab === "actions") {
        const action = QUICK_ACTIONS.find((entry) => entry.id === item.id);
        action?.run({ projectSlug, navigate });
        return;
      }

      void openSession(item, background);
    },
    [activeTab, close, navigate, openSession, projectSlug],
  );

  const openPreview = useCallback((item: LauncherDataItem) => {
    setPreviewTarget({ item, tab: activeTab });
    setPreviewOpen(true);
  }, [activeTab]);

  const runInvestigate = useCallback(
    async (item: LauncherDataItem, background: boolean, closeLauncher: boolean) => {
      if (!item.issueIdentifier) {
        toast.message(t("launcher.toast.noLinkedIssue"));
        return;
      }
      if (closeLauncher) close();
      await investigateLauncherItem({
        projectSlug,
        issueIdentifier: item.issueIdentifier,
        template: resolveInvestigateTemplate(activeTab),
        background,
        view,
        navigate,
        t,
      });
    },
    [activeTab, close, navigate, projectSlug, t, view],
  );

  const runStack = useCallback(
    async (item: LauncherDataItem) => {
      if (item.issueIdentifier) return;

      close();
      await stackStandaloneLauncherItem({
        branchName: stackBranchName(item, activeTab),
        externalUrl: item.externalUrl ?? null,
        t,
        prNumber: item.prNumber,
      });
    },
    [activeTab, close, t],
  );

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();

      if (key >= "1" && key <= "4") {
        event.preventDefault();
        const tab = LAUNCHER_TABS[Number(key) - 1];
        if (tab) setActiveTab(tab.id);
        return;
      }

      if (!highlightedItem || activeTab === "actions") return;

      if (key === "o") {
        event.preventDefault();
        openPreview(highlightedItem);
        return;
      }

      if (key === "m") {
        event.preventDefault();
        const { showInvestigate } = rowActionsForItem(highlightedItem, activeTab);
        if (showInvestigate) {
          void runInvestigate(highlightedItem, false, true);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, highlightedItem, open, openPreview, runInvestigate]);

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        label={t("launcher.title")}
        description={t("launcher.subtitle")}
        shouldFilter={false}
        size="lg"
      >
        <div className="border-b px-4 pb-3 pt-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold leading-none">{t("launcher.title")}</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">{t("launcher.subtitle")}</p>
          </div>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as LauncherTabId)}>
            <TabsList
              aria-label={t("launcher.tabsLabel")}
              className="grid h-auto w-full grid-cols-4 gap-1 bg-muted/80 p-1"
            >
              {LAUNCHER_TABS.map((tab) => {
                const Icon = TAB_ICON[tab.id];
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="gap-1.5 px-2 py-1.5 text-xs data-[state=active]:shadow-sm"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    {t(tab.labelKey)}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t(`launcher.placeholder.${activeTab}`)}
        />
        <CommandList>
          <CommandEmpty>{loading ? t("launcher.loading") : t("launcher.empty")}</CommandEmpty>
          {visible.map((item) => {
            const rowActions = rowActionsForItem(item, activeTab);
            return (
              <CommandItem
                key={item.id}
                value={item.id}
                className="group"
                onMouseEnter={() => setHighlightedId(item.id)}
                onSelect={() => onSelect(item, isModifierPressedRef.current)}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(item, event.metaKey || event.ctrlKey);
                }}
              >
                <LauncherItemRow
                  item={item}
                  tab={activeTab}
                  actions={{
                    showPreview: rowActions.showPreview,
                    showInvestigate: rowActions.showInvestigate,
                    showStack: rowActions.showStack,
                    onPreview: () => openPreview(item),
                    onInvestigate: (background) => void runInvestigate(item, background, !background),
                    onStack: () => void runStack(item),
                  }}
                />
              </CommandItem>
            );
          })}
        </CommandList>
        <div className="border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          {t("launcher.modifierHint")}
        </div>
      </CommandDialog>

      <LauncherPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        projectSlug={projectSlug}
        target={previewTarget}
        onOpenIssue={(issueIdentifier) => {
          setPreviewOpen(false);
          close();
          openLauncherPreviewNavigation({
            projectSlug,
            issueIdentifier,
            view,
            navigate,
            tab: previewTarget?.tab ?? activeTab,
          });
        }}
      />
    </>
  );
}

const isModifierPressedRef = { current: false } as { current: boolean };

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey) isModifierPressedRef.current = true;
  });
  window.addEventListener("keyup", (event) => {
    if (!event.metaKey && !event.ctrlKey) isModifierPressedRef.current = false;
  });
  window.addEventListener("blur", () => {
    isModifierPressedRef.current = false;
  });
}
