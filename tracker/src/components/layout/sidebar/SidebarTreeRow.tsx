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
  statusLabel: string | null;
  trailingLabel: string | null;
  tabIndex: 0 | -1;
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
      statusLabel,
      trailingLabel,
      tabIndex,
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

    return (
      <div
        ref={ref}
        id={`sidebar-tree-${id}`}
        role="treeitem"
        aria-label={accessibleLabel}
        aria-level={level}
        aria-selected={selected}
        aria-expanded={expandable ? expanded : undefined}
        tabIndex={tabIndex}
        title={accessibleLabel}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        className="outline-none"
        data-sidebar-tree-row-id={id}
      >
        <div
          className={cn(
            "group flex min-h-9 items-center gap-1 rounded-md pr-1 text-sm text-foreground",
            "focus-within:bg-accent/70 hover:bg-accent/60",
            selected && "bg-accent text-accent-foreground",
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
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="h-7 w-7 shrink-0" aria-hidden="true" />
          )}
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
            className="flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {statusIndicator ? <span aria-hidden="true">{statusIndicator}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{label}</span>
              {description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {description}
                </span>
              ) : null}
              {metadata ? (
                <span aria-hidden="true" className="flex flex-wrap gap-1 pt-1">
                  {metadata}
                </span>
              ) : null}
            </span>
            {trailingLabel ? (
              <span className="shrink-0 text-xs text-muted-foreground">{trailingLabel}</span>
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
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
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
