import { Loader2 } from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import {
  SidebarTreeRow,
  type SidebarContextMenuRenderer,
} from "@/components/layout/sidebar/SidebarTreeRow";
import type { RecentStatusKind } from "@/types/recents";
import type { SidebarAggregateStatus, SidebarProjectNode } from "@/types/sidebar";

export interface ProjectTreeItemProps {
  node: SidebarProjectNode;
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

export function ProjectTreeItem({
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
}: ProjectTreeItemProps) {
  const { t } = useTranslation();
  const statusLabel = aggregateStatusLabel(node.aggregateStatus, t);
  const sessionCount = node.sessions.length + node.overflowSessions.length;
  const sessionCountLabel = t("layout.sidebar.tree.projectSessionCount", {
    count: sessionCount,
    defaultValue: "{{count}} sessions",
  });
  const loading =
    node.loadState === "loading" || (expanded && node.loadState === "idle");

  return (
    <SidebarTreeRow
      ref={rowRef}
      id={node.id}
      level={1}
      label={node.title}
      description={null}
      selected={selected}
      expandable
      expanded={expanded}
      busy={loading}
      statusLabel={[statusLabel, sessionCountLabel].filter(Boolean).join(", ")}
      trailingLabel={sessionCount > 0 ? String(sessionCount) : null}
      tabIndex={tabIndex}
      leadingIcon={
        loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" aria-hidden="true" />
        ) : undefined
      }
      statusIndicator={
        loading ? null : (
          <RecentStatusDot
            statusKind={aggregateStatusKind(node.aggregateStatus)}
            className="h-1.5 w-1.5"
          />
        )
      }
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

type Translate = (key: string, options: { defaultValue: string }) => string;

export function aggregateStatusLabel(status: SidebarAggregateStatus, t: Translate): string {
  const defaults: Readonly<Record<SidebarAggregateStatus, string>> = {
    idle: "Idle",
    active: "Active",
    attention: "Needs attention",
    error: "Error",
    stale: "Stale",
  };
  return t(`layout.sidebar.tree.aggregateStatus.${status}`, { defaultValue: defaults[status] });
}

function aggregateStatusKind(status: SidebarAggregateStatus): RecentStatusKind {
  switch (status) {
    case "active":
      return "active";
    case "attention":
      return "waiting";
    case "error":
      return "error";
    case "idle":
    case "stale":
      return "idle";
  }
}
