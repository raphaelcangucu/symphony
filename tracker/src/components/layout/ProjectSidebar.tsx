import { KeyRound, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { ProjectNavigationTree } from "@/components/layout/sidebar/ProjectNavigationTree";
import { SidebarCollapsedRail } from "@/components/layout/sidebar/SidebarCollapsedRail";
import { SidebarContextMenu } from "@/components/layout/sidebar/SidebarContextMenu";
import { SidebarFiltersMenu } from "@/components/layout/sidebar/SidebarFiltersMenu";
import { SidebarNewSessionFlow } from "@/components/layout/sidebar/SidebarNewSessionFlow";
import { SidebarSearchLauncher } from "@/components/layout/sidebar/SidebarSearchLauncher";
import { useSidebarTreeContext } from "@/components/layout/sidebar/SidebarTreeContext";
import type { SidebarMenuTriggerElement } from "@/components/layout/sidebar/SidebarTreeRow";
import { SidebarUtilityNav } from "@/components/layout/sidebar/SidebarUtilityNav";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { clearTrackerToken } from "@/config";
import {
  useSidebarActions,
  type SidebarCallbackAction,
  type SidebarPreferenceAction,
} from "@/hooks/useSidebarActions";
import { resolveSidebarRouteSelection } from "@/lib/sidebarRouteResolution";
import { cn } from "@/lib/utils";
import type {
  SidebarCapabilityContext,
  SidebarNode,
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const TRACKER_BRAND_ICON_ALT_KEY = "nav.brandIconAlt";
const TRACKER_BRAND_ICON_SRC = resolveTrackerAssetPath(import.meta.env.BASE_URL, "favicon.svg");

export type ProjectSidebarVariant = "desktop" | "drawer";

export interface ProjectSidebarProps {
  variant?: ProjectSidebarVariant;
}

export function resolveTrackerAssetPath(baseUrl: string, assetName: string): string {
  const normalizedAssetName = assetName.replace(/^\/+/, "");
  if (normalizedAssetName.length === 0) {
    throw new Error("Tracker asset name must not be empty");
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}${normalizedAssetName}`;
}

export function ProjectSidebar({ variant = "desktop" }: ProjectSidebarProps) {
  if (variant !== "desktop" && variant !== "drawer") {
    throw new Error(`Unsupported ProjectSidebar variant: ${String(variant)}`);
  }

  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    tree,
    projectsLoading,
    projectsError,
    projectsErrorDetail,
    preferences,
    preferencesStorageError,
    toggleProjectExpanded,
    toggleWorkspaceExpanded,
    showAllWorkspaces,
    showAllSessions,
    updatePreferences,
    reloadProjects,
    reloadProjectBranch,
  } = useSidebarTreeContext();

  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newSessionSeed, setNewSessionSeed] = useState<{
    projectId: string | null;
    workspaceId: string | null;
  }>({ projectId: null, workspaceId: null });
  const [actionWarning, setActionWarning] = useState<string | null>(null);

  const selection = useMemo(
    () => resolveSidebarRouteSelection(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const expandedProjectIds = useMemo(
    () => new Set(preferences.expandedProjectIds),
    [preferences.expandedProjectIds],
  );
  const expandedWorkspaceIds = useMemo(
    () => new Set(preferences.expandedWorkspaceIds),
    [preferences.expandedWorkspaceIds],
  );

  const visibleNodes = useMemo(
    () => collectVisibleNodes(tree, expandedProjectIds, expandedWorkspaceIds),
    [expandedProjectIds, expandedWorkspaceIds, tree],
  );

  const handlePreferenceAction = useCallback(
    (action: SidebarPreferenceAction) => {
      updatePreferences((current) => {
        if (action.action === "mark-read") {
          return {
            ...current,
            lastReadAtBySession: {
              ...current.lastReadAtBySession,
              [action.sessionId]: action.readAt,
            },
          };
        }
        const key =
          action.nodeKind === "project"
            ? "pinnedProjectIds"
            : action.nodeKind === "workspace"
              ? "pinnedWorkspaceIds"
              : "pinnedSessionIds";
        const currentIds = current[key];
        return {
          ...current,
          [key]: action.pinned
            ? currentIds.includes(action.nodeId)
              ? currentIds
              : [...currentIds, action.nodeId]
            : currentIds.filter((id) => id !== action.nodeId),
        };
      });
    },
    [updatePreferences],
  );

  const handleCallbackAction = useCallback(
    (action: SidebarCallbackAction) => {
      if (action.callback === "navigate") {
        navigate(action.value);
        return;
      }
      if (action.callback === "open-editor") {
        window.open(action.value, "_blank", "noopener,noreferrer");
        return;
      }
      if (action.callback === "open-terminal") {
        window.dispatchEvent(
          new CustomEvent("symphony:open-terminal", { detail: { path: action.value } }),
        );
      }
    },
    [navigate],
  );

  const { runAction } = useSidebarActions({
    onProjectChanged: reloadProjectBranch,
    onPreferenceAction: handlePreferenceAction,
    onCallbackAction: handleCallbackAction,
  });

  const expandSidebar = useCallback(() => {
    if (!preferences.collapsed) return;
    updatePreferences((current) => ({ ...current, collapsed: false }));
  }, [preferences.collapsed, updatePreferences]);

  const toggleCollapsed = useCallback(() => {
    updatePreferences((current) => ({ ...current, collapsed: !current.collapsed }));
  }, [updatePreferences]);

  const openNode = useCallback(
    (href: string) => {
      if (!href.trim()) {
        throw new Error("Sidebar navigation href must not be empty");
      }
      navigate(href);
    },
    [navigate],
  );

  const openNewSession = useCallback(
    (seed?: { projectId?: string | null; workspaceId?: string | null }) => {
      setNewSessionSeed({
        projectId: seed?.projectId ?? selection.projectSlug,
        workspaceId: seed?.workspaceId ?? selection.workspaceId,
      });
      expandSidebar();
      setNewSessionOpen(true);
    },
    [expandSidebar, selection.projectSlug, selection.workspaceId],
  );

  const openSearch = useCallback(() => {
    expandSidebar();
    setSearchOpen(true);
  }, [expandSidebar]);

  const ensureProjectExpanded = useCallback(
    (projectId: string) => {
      if (preferences.expandedProjectIds.includes(projectId)) return;
      toggleProjectExpanded(projectId);
    },
    [preferences.expandedProjectIds, toggleProjectExpanded],
  );

  const renderContextMenu = useCallback(
    (node: SidebarNode, trigger: SidebarMenuTriggerElement) => (
      <SidebarContextMenu
        node={node}
        capabilityContext={capabilityContextFor(node)}
        onRunAction={runAction}
        onUtilityAction={(action, target) => {
          if (action === "new-session") {
            openNewSession({
              projectId: target.projectSlug,
              workspaceId: target.kind === "workspace" ? target.id : target.kind === "session" ? target.workspaceId : null,
            });
            return;
          }
          if (action === "new-workspace") {
            openNewSession({ projectId: target.projectSlug, workspaceId: null });
          }
        }}
        onCommittedWarning={setActionWarning}
      >
        {trigger}
      </SidebarContextMenu>
    ),
    [openNewSession, runAction],
  );

  const onRequestNodeAction = useCallback(
    (node: SidebarNode) => {
      if (node.kind === "project") {
        openNewSession({ projectId: node.id, workspaceId: null });
        return;
      }
      if (node.kind === "workspace") {
        openNewSession({ projectId: node.projectSlug, workspaceId: node.id });
      }
    },
    [openNewSession],
  );

  const collapsed = variant === "drawer" ? false : preferences.collapsed;
  const isDrawer = variant === "drawer";

  return (
    <aside
      data-sidebar-variant={variant}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-muted/20",
        isDrawer
          ? "h-full w-full p-4"
          : "hidden h-screen shrink-0 border-r transition-[width] duration-200 md:flex",
        !isDrawer && (collapsed ? "w-16 p-2" : "w-80 p-3"),
      )}
    >
      <div className={cn("mb-5 flex items-center gap-2.5 px-1", collapsed && "mb-3 flex-col gap-3")}>
        <img
          src={TRACKER_BRAND_ICON_SRC}
          alt={t(TRACKER_BRAND_ICON_ALT_KEY)}
          className="h-8 w-8 rounded-lg shadow-sm"
          decoding="async"
        />
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">{t("nav.brandTitle")}</div>
            <div className="truncate text-xs text-muted-foreground">{t("nav.brandSubtitle")}</div>
          </div>
        )}
        {isDrawer ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            aria-expanded={!collapsed}
            title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            onClick={toggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {collapsed ? (
        <SidebarCollapsedRail
          tree={tree}
          selection={selection}
          onNewSession={() => openNewSession()}
          onSearch={openSearch}
          onOpenProject={(href) => {
            expandSidebar();
            openNode(href);
          }}
        />
      ) : (
        <>
          <SidebarUtilityNav
            className="mb-5"
            onNewSession={() => openNewSession()}
            onSearch={openSearch}
          />

          <div className="mb-2 flex items-center gap-1 px-2">
            <h2 className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("layout.sidebar.tree.label", { defaultValue: "Projects" })}
            </h2>
            <SidebarFiltersMenu
              preferences={preferences}
              visibleNodes={visibleNodes}
              updatePreferences={updatePreferences}
            />
          </div>

          {projectsError ? (
            <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <p>
                {t(projectsError, {
                  detail:
                    projectsErrorDetail ??
                    t("layout.sidebar.errors.unknownDetail"),
                })}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 h-7 px-2 text-xs"
                onClick={() => {
                  void reloadProjects();
                }}
              >
                {t("layout.sidebar.errors.retryProjects")}
              </Button>
            </div>
          ) : null}

          {preferencesStorageError ? (
            <div className="mb-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              {t(preferencesStorageError)}
            </div>
          ) : null}

          {actionWarning ? (
            <div className="mb-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              {actionWarning}
            </div>
          ) : null}

          {projectsLoading && tree.length === 0 ? (
            <div className="mb-2 px-2 text-xs text-muted-foreground">
              {t("layout.projectHeader.loadingProjects", { defaultValue: "Loading projects…" })}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col">
            <ProjectNavigationTree
              tree={tree}
              expandedProjectIds={expandedProjectIds}
              expandedWorkspaceIds={expandedWorkspaceIds}
              currentSelection={selection}
              toggleProject={toggleProjectExpanded}
              toggleWorkspace={toggleWorkspaceExpanded}
              openNode={openNode}
              renderContextMenu={renderContextMenu}
              onRequestNodeAction={onRequestNodeAction}
              retryProject={(projectId) => {
                void reloadProjectBranch(projectId);
              }}
              showAllWorkspaces={showAllWorkspaces}
              showAllSessions={showAllSessions}
            />
          </div>
        </>
      )}

      <div className={cn("mt-auto flex items-center gap-2 pt-3", collapsed && "flex-col")}>
        <ThemeToggle />
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label={t("nav.resetToken")}
            title={t("nav.resetToken")}
            onClick={() => {
              clearTrackerToken();
              window.location.assign("/token");
            }}
          >
            <KeyRound className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start text-muted-foreground"
            onClick={() => {
              clearTrackerToken();
              window.location.assign("/token");
            }}
          >
            <KeyRound className="h-4 w-4" />
            {t("nav.resetToken")}
          </Button>
        )}
      </div>

      <SidebarNewSessionFlow
        open={newSessionOpen}
        selection={selection}
        tree={tree}
        initialProjectId={newSessionSeed.projectId}
        initialWorkspaceId={newSessionSeed.workspaceId}
        onOpenChange={setNewSessionOpen}
        ensureProjectExpanded={ensureProjectExpanded}
        onCreated={(projectSlug, threadId) => {
          setNewSessionOpen(false);
          navigate(`/projects/${encodeURIComponent(projectSlug)}/workspaces/${threadId}`);
          void reloadProjectBranch(projectSlug);
        }}
      />

      <SidebarSearchLauncher
        open={searchOpen}
        tree={tree}
        loading={projectsLoading}
        onOpenChange={setSearchOpen}
        onOpenNode={(href) => {
          setSearchOpen(false);
          openNode(href);
        }}
        onRequestProjectExpand={ensureProjectExpanded}
      />
    </aside>
  );
}

function collectVisibleNodes(
  tree: readonly SidebarProjectNode[],
  expandedProjectIds: ReadonlySet<string>,
  expandedWorkspaceIds: ReadonlySet<string>,
): SidebarNode[] {
  const nodes: SidebarNode[] = [];
  for (const project of tree) {
    nodes.push(project);
    if (!expandedProjectIds.has(project.id)) continue;
    for (const workspace of [...project.workspaces, ...project.overflowWorkspaces]) {
      nodes.push(workspace);
      if (!expandedWorkspaceIds.has(workspace.id)) continue;
      nodes.push(...workspace.sessions, ...workspace.overflowSessions);
    }
    nodes.push(...project.unassignedSessions);
  }
  return nodes;
}

function capabilityContextFor(node: SidebarNode): SidebarCapabilityContext {
  if (node.kind === "project") {
    return emptyCapabilityContext();
  }
  if (node.kind === "workspace") {
    return workspaceCapabilityContext(node);
  }
  return sessionCapabilityContext(node);
}

function workspaceCapabilityContext(node: SidebarWorkspaceNode): SidebarCapabilityContext {
  const path = nonBlank(node.inventory?.path);
  return {
    editorTarget: path ? `vscode://file${path.startsWith("/") ? path : `/${path}`}` : null,
    terminalTarget: path,
    workspacePath: path,
    branchName: nonBlank(node.branchSummary),
    workspaceRemovable: node.inventory?.removable === true,
    issueCapabilities: node.issueIdentifier
      ? { canRename: true, canManageLabels: true }
      : null,
    threadCapabilities: null,
  };
}

function sessionCapabilityContext(node: SidebarSessionNode): SidebarCapabilityContext {
  const localThread = node.threadId != null && node.sessionKind === "chat";
  return {
    editorTarget: null,
    terminalTarget: null,
    workspacePath: null,
    branchName: null,
    workspaceRemovable: false,
    issueCapabilities: node.issueIdentifier
      ? { canRename: true, canManageLabels: true }
      : null,
    threadCapabilities: localThread
      ? {
          canRename: true,
          canManageLabels: true,
          canReview: true,
          canArchive: true,
          canDelete: true,
          local: true,
          active: node.aggregateStatus === "active",
          closed: node.archived || node.statusKind === "closed" || node.statusKind === "done",
        }
      : null,
  };
}

function emptyCapabilityContext(): SidebarCapabilityContext {
  return {
    editorTarget: null,
    terminalTarget: null,
    workspacePath: null,
    branchName: null,
    workspaceRemovable: false,
    issueCapabilities: null,
    threadCapabilities: null,
  };
}

function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
