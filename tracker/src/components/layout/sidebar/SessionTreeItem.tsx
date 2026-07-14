import type { KeyboardEvent, Ref } from "react";
import { useTranslation } from "react-i18next";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import {
  SidebarTreeRow,
  type SidebarContextMenuRenderer,
} from "@/components/layout/sidebar/SidebarTreeRow";
import {
  SessionAgentBadge,
  SessionBadgeShell,
  SessionStatusKindBadge,
  SessionTypeBadge,
} from "@/components/shared/SessionBadge";
import { formatRelativeTime } from "@/lib/utils";
import type { SidebarSessionNode } from "@/types/sidebar";

export interface SessionTreeItemProps {
  node: SidebarSessionNode;
  selected: boolean;
  tabIndex: 0 | -1;
  rowRef: Ref<HTMLDivElement>;
  onFocus(): void;
  onOpen(): void;
  renderContextMenu: SidebarContextMenuRenderer;
  onPreserveFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}

export function SessionTreeItem({
  node,
  selected,
  tabIndex,
  rowRef,
  onFocus,
  onOpen,
  renderContextMenu,
  onPreserveFocus,
  onKeyDown,
}: SessionTreeItemProps) {
  const { t } = useTranslation();
  const statusLabel = t(`layout.recents.status.${node.statusKind}`, {
    defaultValue: statusDefault(node.statusKind),
  });
  const typeLabel = t(`layout.sidebar.tree.sessionKind.${node.sessionKind}`, {
    defaultValue:
      node.sessionKind === "execution"
        ? "Execution"
        : node.sessionKind === "authoring"
          ? "Authoring"
          : "Chat",
  });
  const relativeTime = formatRelativeTime(node.updatedAt);

  return (
    <SidebarTreeRow
      ref={rowRef}
      id={node.id}
      level={3}
      label={node.title}
      description={node.subtitle}
      selected={selected}
      expandable={false}
      expanded={false}
      statusLabel={statusLabel}
      trailingLabel={relativeTime}
      tabIndex={tabIndex}
      statusIndicator={<RecentStatusDot statusKind={node.statusKind} />}
      metadata={
        <>
          {node.sessionKind === "chat" || node.sessionKind === "execution" ? (
            <SessionTypeBadge kind={node.sessionKind} />
          ) : (
            <SessionBadgeShell label={typeLabel} />
          )}
          {node.agentKind ? <SessionAgentBadge kind={node.agentKind} /> : null}
          <SessionStatusKindBadge statusKind={node.statusKind} label={statusLabel} />
          {node.unread ? (
            <SessionBadgeShell
              label={t("layout.sidebar.tree.unread", { defaultValue: "Unread" })}
            />
          ) : null}
          {node.needsReview ? (
            <SessionBadgeShell
              label={t("layout.sidebar.tree.needsReview", { defaultValue: "Review" })}
            />
          ) : null}
        </>
      }
      onFocus={onFocus}
      onOpen={onOpen}
      onToggle={() => undefined}
      renderContextMenu={renderContextMenu}
      onPreserveFocus={onPreserveFocus}
      onKeyDown={onKeyDown}
    />
  );
}

function statusDefault(status: SidebarSessionNode["statusKind"]): string {
  const defaults: Readonly<Record<SidebarSessionNode["statusKind"], string>> = {
    running: "Running",
    waiting: "Waiting",
    retrying: "Retrying",
    idle: "Idle",
    active: "Active",
    in_progress: "In progress",
    todo: "To do",
    done: "Done",
    closed: "Closed",
    error: "Error",
    aborted: "Aborted",
  };
  return defaults[status];
}
