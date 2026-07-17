import type { KeyboardEvent, Ref } from "react";
import { useTranslation } from "react-i18next";

import {
  SidebarTreeRow,
  type SidebarContextMenuRenderer,
} from "@/components/layout/sidebar/SidebarTreeRow";
import { ChatStatusIcon } from "@/components/shared/ChatStatusIcon";
import { SessionBadgeShell } from "@/components/shared/SessionBadge";
import { formatRelativeTime } from "@/lib/utils";
import type { SidebarSessionNode } from "@/types/sidebar";

export interface SessionTreeItemProps {
  node: SidebarSessionNode;
  level?: 2 | 3;
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
  level = 3,
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
      level={level}
      label={node.title}
      description={descriptionParts.join(" · ") || null}
      selected={selected}
      expandable={false}
      expanded={false}
      statusLabel={statusLabel}
      trailingLabel={relativeTime}
      tabIndex={tabIndex}
      leadingIcon={
        <ChatStatusIcon
          sessionKind={node.sessionKind}
          executionMode={node.executionMode}
          statusKind={node.statusKind}
          aggregateStatus={node.aggregateStatus}
          needsAttention={node.needsReview}
        />
      }
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
