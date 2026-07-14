import { MessageSquare } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";
import { useTranslation } from "react-i18next";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import {
  SidebarTreeRow,
  type SidebarContextMenuRenderer,
} from "@/components/layout/sidebar/SidebarTreeRow";
import { SessionBadgeShell } from "@/components/shared/SessionBadge";
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
  const agentLabel = node.agentKind
    ? t(`layout.sidebar.tree.agent.${node.agentKind}`, {
        defaultValue: agentDefault(node.agentKind),
      })
    : null;
  const descriptionParts = [
    typeLabel,
    agentLabel,
    node.subtitle?.trim() || null,
  ].filter((value): value is string => Boolean(value));

  return (
    <SidebarTreeRow
      ref={rowRef}
      id={node.id}
      level={3}
      label={node.title}
      description={descriptionParts.join(" · ") || null}
      selected={selected}
      expandable={false}
      expanded={false}
      statusLabel={statusLabel}
      trailingLabel={relativeTime}
      tabIndex={tabIndex}
      leadingIcon={<MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />}
      statusIndicator={<RecentStatusDot statusKind={node.statusKind} className="h-1.5 w-1.5" />}
      metadata={
        node.unread || node.needsReview ? (
          <>
            {node.unread ? (
              <span
                title={t("layout.sidebar.tree.unread", { defaultValue: "Unread" })}
                className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500"
              />
            ) : null}
            {node.needsReview ? (
              <SessionBadgeShell
                label={t("layout.sidebar.tree.needsReview", { defaultValue: "Review" })}
              />
            ) : null}
          </>
        ) : null
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

function agentDefault(agent: NonNullable<SidebarSessionNode["agentKind"]>): string {
  const defaults: Readonly<Record<NonNullable<SidebarSessionNode["agentKind"]>, string>> = {
    codex: "Codex",
    claude: "Claude",
    cursor: "Cursor",
    opencode: "OpenCode",
  };
  return defaults[agent] ?? agent;
}
