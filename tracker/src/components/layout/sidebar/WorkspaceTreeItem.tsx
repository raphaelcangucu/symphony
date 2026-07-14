import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import {
  aggregateStatusLabel,
} from "@/components/layout/sidebar/ProjectTreeItem";
import {
  SidebarTreeRow,
  type SidebarContextMenuRenderer,
} from "@/components/layout/sidebar/SidebarTreeRow";
import type { RecentStatusKind } from "@/types/recents";
import type {
  SidebarAggregateStatus,
  SidebarWorkspaceKind,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const WORKSPACE_KIND_DEFAULTS: Readonly<Record<SidebarWorkspaceKind, string>> = {
  project: "Project",
  issue: "Issue",
  standalone: "Standalone",
  parallel: "Parallel",
  orphan: "Orphan",
};

export interface WorkspaceTreeItemProps {
  node: SidebarWorkspaceNode;
  selected: boolean;
  expanded: boolean;
  tabIndex: 0 | -1;
  rowRef: Ref<HTMLDivElement>;
  children?: ReactNode;
  onFocus(): void;
  onOpen(): void;
  onToggle(): void;
  renderContextMenu: SidebarContextMenuRenderer;
  onPreserveFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}

export function WorkspaceTreeItem({
  node,
  selected,
  expanded,
  tabIndex,
  rowRef,
  children,
  onFocus,
  onOpen,
  onToggle,
  renderContextMenu,
  onPreserveFocus,
  onKeyDown,
}: WorkspaceTreeItemProps) {
  const { t } = useTranslation();
  const sessionCount = node.sessions.length + node.overflowSessions.length;
  const kindLabel = t(`layout.sidebar.tree.workspaceKind.${node.workspaceKind}`, {
    defaultValue: WORKSPACE_KIND_DEFAULTS[node.workspaceKind],
  });
  const sessionCountLabel = t("layout.sidebar.tree.sessionCount", {
    count: sessionCount,
    defaultValue: "{{count}} sessions",
  });
  const description = [kindLabel, node.branchSummary, sessionCountLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <SidebarTreeRow
      ref={rowRef}
      id={node.id}
      level={2}
      label={node.title}
      description={description}
      selected={selected}
      expandable
      expanded={expanded}
      statusLabel={aggregateStatusLabel(node.aggregateStatus, t)}
      trailingLabel={null}
      tabIndex={tabIndex}
      statusIndicator={<RecentStatusDot statusKind={aggregateStatusKind(node.aggregateStatus)} />}
      onFocus={onFocus}
      onOpen={onOpen}
      onToggle={onToggle}
      renderContextMenu={renderContextMenu}
      onPreserveFocus={onPreserveFocus}
      onKeyDown={onKeyDown}
    >
      {children}
    </SidebarTreeRow>
  );
}

function aggregateStatusKind(status: SidebarAggregateStatus): RecentStatusKind {
  if (status === "active") return "active";
  if (status === "attention") return "waiting";
  if (status === "error") return "error";
  return "idle";
}
