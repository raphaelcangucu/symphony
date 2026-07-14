import {
  useCallback,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { ProjectTreeItem } from "@/components/layout/sidebar/ProjectTreeItem";
import { SessionTreeItem } from "@/components/layout/sidebar/SessionTreeItem";
import type { SidebarMenuTriggerElement } from "@/components/layout/sidebar/SidebarTreeRow";
import {
  SidebarBranchState,
  SidebarPseudoTreeItem,
} from "@/components/layout/sidebar/SidebarBranchState";
import {
  buildSidebarVisibleRows,
  normalizeSidebarTree,
  syntheticRowId,
  type SidebarSyntheticNode,
  type SidebarVisibleRow,
} from "@/components/layout/sidebar/sidebarVisibleRows";
import { useTreeRovingFocus } from "@/components/layout/sidebar/useTreeRovingFocus";
import { WorkspaceTreeItem } from "@/components/layout/sidebar/WorkspaceTreeItem";
import { resolveTreeKeyboardCommand } from "@/lib/sidebarTreeKeyboard";
import type { SidebarRouteSelection } from "@/lib/sidebarRouteResolution";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type {
  SidebarNode,
  SidebarProjectNode,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

export interface ProjectNavigationTreeProps {
  readonly tree: readonly SidebarProjectNode[];
  readonly expandedProjectIds: ReadonlySet<string>;
  readonly expandedWorkspaceIds: ReadonlySet<string>;
  readonly currentSelection: SidebarRouteSelection;
  readonly ariaLabel?: string;
  toggleProject(projectId: string): void;
  toggleWorkspace(workspaceId: string): void;
  openNode(href: string): void;
  renderContextMenu(node: SidebarNode, trigger: SidebarMenuTriggerElement): ReactNode;
  onRequestNodeAction(node: SidebarNode): void;
  retryProject(projectId: string): void;
  showAllWorkspaces(projectId: string): void;
  showAllSessions(workspaceId: string): void;
}

export function ProjectNavigationTree(props: ProjectNavigationTreeProps) {
  assertCallbacks(props);
  const {
    tree,
    expandedProjectIds,
    expandedWorkspaceIds,
    currentSelection,
    ariaLabel,
    toggleProject,
    toggleWorkspace,
    openNode,
    renderContextMenu,
    onRequestNodeAction,
    retryProject,
    showAllWorkspaces,
    showAllSessions,
  } = props;
  const { t } = useTranslation();
  const projects = useMemo(() => normalizeSidebarTree(tree), [tree]);
  const visibleRows = useMemo(
    () => buildSidebarVisibleRows(projects, expandedProjectIds, expandedWorkspaceIds),
    [expandedProjectIds, expandedWorkspaceIds, projects],
  );
  const rowById = useMemo(
    () => new Map(visibleRows.map((row) => [row.id, row] as const)),
    [visibleRows],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const selectedId = visibleSelectionId(visibleRows, currentSelection);
  const focus = useTreeRovingFocus(visibleRows, selectedId);

  const activateSynthetic = useCallback(
    (node: SidebarSyntheticNode, trigger: HTMLElement) => {
      const project = projectById.get(node.projectId);
      if (!project) return;
      if (node.syntheticKind === "error") {
        retryProject(project.id);
        return;
      }
      if (node.syntheticKind === "empty-project") {
        onRequestNodeAction(project);
        return;
      }
      if (node.syntheticKind === "more-workspaces") {
        showAllWorkspaces(project.id);
        return;
      }
      const workspace = node.workspaceId
        ? project.workspaces.find(({ id }) => id === node.workspaceId)
        : undefined;
      if (!workspace) return;
      if (node.syntheticKind === "empty-workspace") onRequestNodeAction(workspace);
      if (node.syntheticKind === "more-sessions") showAllSessions(workspace.id);
    },
    [onRequestNodeAction, projectById, retryProject, showAllSessions, showAllWorkspaces],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, row: SidebarVisibleRow) => {
      const command = resolveTreeKeyboardCommand({
        key: event.key,
        focusedId: row.id,
        rows: visibleRows,
        menuOpen: false,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      if (command.type === "noop") return;
      event.preventDefault();
      event.stopPropagation();
      const target = rowById.get("id" in command ? command.id : "");

      if (command.type === "focus") {
        focus.focusRow(command.id);
        return;
      }
      if (command.type === "expand" || command.type === "collapse") {
        if (target?.node.kind === "project") toggleProject(target.id);
        else if (target?.node.kind === "workspace") toggleWorkspace(target.id);
        else if (target?.node.kind === "synthetic" && target.node.parentId) {
          focus.focusRow(target.node.parentId);
        }
        return;
      }
      if (command.type === "open") {
        if (!target) return;
        const trigger = focus.rowElement(target.id);
        if (target.node.kind === "synthetic") {
          if (trigger) activateSynthetic(target.node, trigger);
        } else {
          openNode(target.node.href);
        }
        return;
      }
      if (command.type === "open-menu") {
        if (!target || target.node.kind === "synthetic") return;
        const rowElement = focus.rowElement(target.id);
        const trigger = rowElement?.querySelector<HTMLButtonElement>(
          '[data-sidebar-context-menu-trigger="true"]',
        );
        if (trigger) {
          trigger.focus();
          trigger.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              button: 2,
            }),
          );
        }
        return;
      }
    },
    [
      activateSynthetic,
      focus,
      openNode,
      rowById,
      toggleProject,
      toggleWorkspace,
      visibleRows,
    ],
  );

  const commonRowProps = (row: SidebarVisibleRow) => ({
    selected: row.id === selectedId,
    tabIndex: (row.id === focus.tabStopId ? 0 : -1) as 0 | -1,
    rowRef: focus.registerRow(row.id),
    onFocus: () => focus.noteRowFocus(row.id),
    onPreserveFocus: () => focus.focusRow(row.id),
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => handleKeyDown(event, row),
  });

  const renderSession = (sessionId: string) => {
    const row = rowById.get(sessionId);
    if (!row || row.node.kind !== "session") return null;
    return (
      <SessionTreeItem
        key={row.id}
        node={row.node}
        {...commonRowProps(row)}
        onOpen={() => openNode(row.node.kind === "session" ? row.node.href : "")}
        renderContextMenu={(trigger) => renderContextMenu(row.node as SidebarNode, trigger)}
      />
    );
  };

  const renderSyntheticAction = (
    row: SidebarVisibleRow,
    label: string,
    actionLabel: string,
  ) => (
    <SidebarPseudoTreeItem
      key={row.id}
      id={row.id}
      level={row.level === 2 ? 2 : 3}
      label={label}
      actionLabel={actionLabel}
      {...commonRowProps(row)}
      onActivate={(trigger) => {
        if (row.node.kind === "synthetic") activateSynthetic(row.node, trigger);
      }}
    />
  );

  const renderWorkspace = (project: SidebarProjectNode, workspace: SidebarWorkspaceNode) => {
    const row = rowById.get(workspace.id);
    if (!row) return null;
    const expanded = expandedWorkspaceIds.has(workspace.id);
    const emptyId = syntheticRowId("empty-workspace", project.id, workspace.id);
    const moreId = syntheticRowId("more-sessions", project.id, workspace.id);
    return (
      <WorkspaceTreeItem
        key={workspace.id}
        node={workspace}
        expanded={expanded}
        {...commonRowProps(row)}
        onOpen={() => openNode(workspace.href)}
        onToggle={() => toggleWorkspace(workspace.id)}
        renderContextMenu={(trigger) => renderContextMenu(workspace, trigger)}
      >
        {expanded ? (
          <div role="group">
            {workspace.sessions.map(({ id }) => renderSession(id))}
            {rowById.has(emptyId)
              ? renderSyntheticAction(
                  rowById.get(emptyId)!,
                  t("layout.sidebar.tree.emptyWorkspace", {
                    workspace: workspace.title,
                    defaultValue: "No sessions in {{workspace}}",
                  }),
                  t("layout.sidebar.tree.createSession", {
                    workspace: workspace.title,
                    defaultValue: "Create session in {{workspace}}",
                  }),
                )
              : null}
            {rowById.has(moreId)
              ? renderSyntheticAction(
                  rowById.get(moreId)!,
                  t("layout.sidebar.tree.moreSessions", {
                    count: workspace.overflowSessions.length,
                    defaultValue: "{{count}} more sessions",
                  }),
                  t("layout.sidebar.tree.moreSessions", {
                    count: workspace.overflowSessions.length,
                    defaultValue: "{{count}} more sessions",
                  }),
                )
              : null}
          </div>
        ) : null}
      </WorkspaceTreeItem>
    );
  };

  return (
    <div
      role="tree"
      aria-label={ariaLabel ?? t("layout.sidebar.tree.label", { defaultValue: "Projects" })}
      onFocusCapture={focus.onTreeFocusCapture}
      onBlurCapture={focus.onTreeBlurCapture}
      className={cn("min-h-0 overflow-y-auto px-1 py-1", SCROLLBAR_THIN)}
      data-sidebar-tree-scroll-container="true"
    >
      {projects.map((project) => {
        const row = rowById.get(project.id);
        if (!row) return null;
        const expanded = expandedProjectIds.has(project.id);
        const branchRow = visibleRows.find(
          (candidate) =>
            candidate.parentId === project.id &&
            candidate.node.kind === "synthetic" &&
            ["loading", "error", "stale", "empty-project"].includes(
              candidate.node.syntheticKind,
            ),
        );
        const moreId = syntheticRowId("more-workspaces", project.id, null);
        const unassignedId = syntheticRowId("unassigned", project.id, null);
        const unassignedRow = rowById.get(unassignedId);
        return (
          <ProjectTreeItem
            key={project.id}
            node={project}
            expanded={expanded}
            {...commonRowProps(row)}
            onOpen={() => openNode(project.href)}
            onToggle={() => toggleProject(project.id)}
            renderContextMenu={(trigger) => renderContextMenu(project, trigger)}
          >
            {expanded ? (
              <div role="group">
                {branchRow && branchRow.node.kind === "synthetic" ? (
                  <SidebarBranchState
                    project={project}
                    kind={branchRow.node.syntheticKind as "loading" | "error" | "stale" | "empty-project"}
                    id={branchRow.id}
                    {...commonRowProps(branchRow)}
                    onActivate={(trigger) => activateSynthetic(branchRow.node as SidebarSyntheticNode, trigger)}
                  />
                ) : null}
                {project.workspaces.map((workspace) => renderWorkspace(project, workspace))}
                {rowById.has(moreId)
                  ? renderSyntheticAction(
                      rowById.get(moreId)!,
                      t("layout.sidebar.tree.moreWorkspaces", {
                        count: project.overflowWorkspaces.length,
                        defaultValue: "{{count}} more workspaces",
                      }),
                      t("layout.sidebar.tree.moreWorkspaces", {
                        count: project.overflowWorkspaces.length,
                        defaultValue: "{{count}} more workspaces",
                      }),
                    )
                  : null}
                {unassignedRow ? (
                  <SidebarPseudoTreeItem
                    id={unassignedRow.id}
                    level={2}
                    label={t("layout.sidebar.tree.unassigned", { defaultValue: "No workspace" })}
                    expanded
                    {...commonRowProps(unassignedRow)}
                  >
                    <div role="group">
                      {project.unassignedSessions.map(({ id }) => renderSession(id))}
                    </div>
                  </SidebarPseudoTreeItem>
                ) : null}
              </div>
            ) : null}
          </ProjectTreeItem>
        );
      })}
    </div>
  );
}

function visibleSelectionId(
  rows: readonly SidebarVisibleRow[],
  selection: SidebarRouteSelection,
): string | null {
  if (!selection || typeof selection !== "object") return null;
  const ids = new Set(rows.map(({ id }) => id));
  if (typeof selection.sessionId === "string" && ids.has(selection.sessionId)) {
    return selection.sessionId;
  }
  if (typeof selection.workspaceId === "string" && ids.has(selection.workspaceId)) {
    return selection.workspaceId;
  }
  if (typeof selection.projectSlug === "string" && ids.has(selection.projectSlug)) {
    return selection.projectSlug;
  }
  return null;
}

function assertCallbacks(props: ProjectNavigationTreeProps): void {
  const names = [
    "toggleProject",
    "toggleWorkspace",
    "openNode",
    "renderContextMenu",
    "onRequestNodeAction",
    "retryProject",
    "showAllWorkspaces",
    "showAllSessions",
  ] as const;
  for (const name of names) {
    if (typeof props[name] !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
  }
}
