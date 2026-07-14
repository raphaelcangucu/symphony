import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { sidebarTreeIndent } from "@/components/layout/sidebar/sidebarVisibleRows";
import { cn } from "@/lib/utils";

export type SidebarMenuTriggerElement = ReactElement<
  ComponentPropsWithoutRef<"button">,
  "button"
>;

export type SidebarContextMenuRenderer = (trigger: SidebarMenuTriggerElement) => ReactNode;

export interface SidebarTreeRowProps {
  id: string;
  level: 1 | 2 | 3;
  label: string;
  description: string | null;
  selected: boolean;
  expandable: boolean;
  expanded: boolean;
  busy?: boolean;
  statusLabel: string | null;
  trailingLabel: string | null;
  tabIndex: 0 | -1;
  leadingIcon?: ReactNode;
  statusIndicator?: ReactNode;
  metadata?: ReactNode;
  children?: ReactNode;
  onFocus(): void;
  onOpen(): void;
  onToggle(): void;
  renderContextMenu: SidebarContextMenuRenderer;
  onPreserveFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}

export const SidebarTreeRow = forwardRef<HTMLDivElement, SidebarTreeRowProps>(
  function SidebarTreeRow(
    {
      id,
      level,
      label,
      description,
      selected,
      expandable,
      expanded,
      busy = false,
      statusLabel,
      trailingLabel,
      tabIndex,
      leadingIcon,
      statusIndicator,
      metadata,
      children,
      onFocus,
      onOpen,
      onToggle,
      renderContextMenu,
      onPreserveFocus,
      onKeyDown,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const accessibleLabel = [label, description, statusLabel, trailingLabel]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(", ");
    const stopAndToggle = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onToggle();
    };
    const stopEmbeddedKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (isDelegatedTreeKey(event)) {
        event.preventDefault();
        onKeyDown(event as unknown as KeyboardEvent<HTMLDivElement>);
      }
    };
    const preserveTreeItemFocus = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      onPreserveFocus();
    };
    const isLeaf = level >= 3;

    return (
      <div
        ref={ref}
        id={`sidebar-tree-${id}`}
        role="treeitem"
        aria-label={accessibleLabel}
        aria-level={level}
        aria-selected={selected}
        aria-expanded={expandable ? expanded : undefined}
        aria-busy={busy || undefined}
        tabIndex={tabIndex}
        title={accessibleLabel}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        className="outline-none"
        data-sidebar-tree-row-id={id}
      >
        <div
          className={cn(
            "group mx-0.5 flex min-h-7 items-center gap-0.5 rounded-md py-0.5 pr-1 text-xs text-foreground",
            "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
            "focus-within:bg-black/[0.05] dark:focus-within:bg-white/[0.08]",
            selected &&
              "bg-black/[0.07] text-foreground shadow-none dark:bg-white/[0.1]",
          )}
          style={{ paddingLeft: `${sidebarTreeIndent(level)}px` }}
        >
          {expandable ? (
            <button
              type="button"
              tabIndex={-1}
              data-sidebar-tree-owner-id={id}
              aria-label={t(
                expanded ? "layout.sidebar.tree.collapseNode" : "layout.sidebar.tree.expandNode",
                {
                  label,
                  defaultValue: `${expanded ? "Collapse" : "Expand"} {{label}}`,
                },
              )}
              title={t(
                expanded ? "layout.sidebar.tree.collapseNode" : "layout.sidebar.tree.expandNode",
                {
                  label,
                  defaultValue: `${expanded ? "Collapse" : "Expand"} {{label}}`,
                },
              )}
              onClick={stopAndToggle}
              onMouseDown={preserveTreeItemFocus}
              onKeyDown={stopEmbeddedKeyDown}
              className="inline-flex h-5 w-3.5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            tabIndex={-1}
            data-sidebar-tree-owner-id={id}
            aria-label={t("layout.sidebar.tree.openNode", {
              label,
              defaultValue: "Open {{label}}",
            })}
            title={accessibleLabel}
            onClick={onOpen}
            onMouseDown={preserveTreeItemFocus}
            onKeyDown={stopEmbeddedKeyDown}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {leadingIcon ? (
              <span
                aria-hidden="true"
                className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground"
              >
                {leadingIcon}
                {statusIndicator ? (
                  <span className="absolute -right-0.5 -top-0.5">{statusIndicator}</span>
                ) : null}
              </span>
            ) : statusIndicator ? (
              <span aria-hidden="true" className="shrink-0">
                {statusIndicator}
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate leading-4",
                    isLeaf ? "font-normal" : "font-medium",
                    selected && "text-foreground",
                  )}
                >
                  {label}
                </span>
                {trailingLabel ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">
                    {trailingLabel}
                  </span>
                ) : null}
              </span>
              {description ? <span className="sr-only">{description}</span> : null}
            </span>
            {metadata ? (
              <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
                {metadata}
              </span>
            ) : null}
            {statusLabel ? <span className="sr-only">{statusLabel}</span> : null}
          </button>
          {renderContextMenu(
            <button
              type="button"
              tabIndex={-1}
              data-sidebar-tree-owner-id={id}
              data-sidebar-context-menu-trigger="true"
              aria-label={t("layout.sidebar.tree.moreActions", {
                label,
                defaultValue: "More actions for {{label}}",
              })}
              title={t("layout.sidebar.tree.moreActions", {
                label,
                defaultValue: "More actions for {{label}}",
              })}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={preserveTreeItemFocus}
              onKeyDown={stopEmbeddedKeyDown}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 hover:bg-black/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 dark:hover:bg-white/[0.08]"
            >
              <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            </button>,
          )}
        </div>
        {children}
      </div>
    );
  },
);

function isDelegatedTreeKey(event: KeyboardEvent<HTMLButtonElement>): boolean {
  return (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
      event.key,
    ) ||
    (event.key === "F10" && event.shiftKey)
  );
}
