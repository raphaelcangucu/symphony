import { Loader2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";

import {
  sidebarTreeIndent,
  type SidebarSyntheticKind,
} from "@/components/layout/sidebar/sidebarVisibleRows";
import { cn } from "@/lib/utils";
import type { SidebarProjectNode } from "@/types/sidebar";

interface SidebarBranchStateProps {
  project: SidebarProjectNode;
  kind: Extract<SidebarSyntheticKind, "loading" | "error" | "stale" | "empty-project">;
  id: string;
  tabIndex: 0 | -1;
  rowRef: Ref<HTMLDivElement>;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onActivate(triggerElement: HTMLElement): void;
  onPreserveFocus(): void;
}

export function SidebarBranchState({
  project,
  kind,
  id,
  tabIndex,
  rowRef,
  onFocus,
  onKeyDown,
  onActivate,
  onPreserveFocus,
}: SidebarBranchStateProps) {
  const { t } = useTranslation();

  if (kind === "loading") {
    const label = t("layout.sidebar.tree.loadingWorkspaces", {
      project: project.title,
      defaultValue: "Loading workspaces for {{project}}",
    });
    return (
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={2}
        aria-label={label}
        aria-busy="true"
        tabIndex={tabIndex}
        title={label}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        className="sr-only"
        data-sidebar-tree-row-id={id}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (kind === "error") {
    const label = t("layout.sidebar.tree.projectError", {
      error: project.error ?? "",
      defaultValue: "Could not load: {{error}}",
    });
    const actionLabel = t("layout.sidebar.tree.retryProject", {
      project: project.title,
      defaultValue: "Retry {{project}}",
    });
    return (
      <SidebarPseudoTreeItem
        id={id}
        level={2}
        label={label}
        actionLabel={actionLabel}
        tabIndex={tabIndex}
        rowRef={rowRef}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onActivate={onActivate}
        onPreserveFocus={onPreserveFocus}
        tone="error"
      />
    );
  }

  const stale = kind === "stale";
  if (stale) {
    return (
      <SidebarPseudoTreeItem
        id={id}
        level={2}
        label={t("layout.sidebar.tree.stale", { defaultValue: "Stale data" })}
        tabIndex={tabIndex}
        rowRef={rowRef}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onPreserveFocus={onPreserveFocus}
        tone="stale"
      />
    );
  }

  return (
    <SidebarPseudoTreeItem
      id={id}
      level={2}
      label={t("layout.sidebar.tree.emptyProject", {
        defaultValue: "No workspaces",
      })}
      actionLabel={t("layout.sidebar.tree.createWorkspace", {
        defaultValue: "Create",
      })}
      actionAriaLabel={t("layout.sidebar.tree.createWorkspaceNamed", {
        project: project.title,
        defaultValue: "Create workspace in {{project}}",
      })}
      tabIndex={tabIndex}
      rowRef={rowRef}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onActivate={onActivate}
      onPreserveFocus={onPreserveFocus}
      variant="soft"
    />
  );
}

export interface SidebarPseudoTreeItemProps {
  id: string;
  level: 2 | 3;
  label: string;
  tabIndex: 0 | -1;
  rowRef: Ref<HTMLDivElement>;
  expanded?: boolean;
  actionLabel?: string;
  actionAriaLabel?: string;
  tone?: "default" | "error" | "stale";
  variant?: "boxed" | "soft";
  children?: ReactNode;
  onFocus(): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onActivate?(triggerElement: HTMLElement): void;
  onPreserveFocus(): void;
}

export function SidebarPseudoTreeItem({
  id,
  level,
  label,
  tabIndex,
  rowRef,
  expanded,
  actionLabel,
  actionAriaLabel,
  tone = "default",
  variant = "boxed",
  children,
  onFocus,
  onKeyDown,
  onActivate,
  onPreserveFocus,
}: SidebarPseudoTreeItemProps) {
  const handleEmbeddedKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
        event.key,
      ) ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault();
      onKeyDown(event as unknown as KeyboardEvent<HTMLDivElement>);
    }
  };

  const actionName = actionAriaLabel ?? actionLabel;
  const soft = variant === "soft";

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={level}
      aria-label={soft && actionName ? `${label}, ${actionName}` : label}
      aria-expanded={expanded}
      tabIndex={tabIndex}
      title={label}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className="outline-none"
      data-sidebar-tree-row-id={id}
    >
      {soft ? (
        <div
          className="mx-0.5 flex min-h-8 items-center gap-1.5 py-0.5 pr-1 text-sm"
          style={{ paddingLeft: `${sidebarTreeIndent(level) + 16}px` }}
        >
          <span className="text-muted-foreground/80">{label}</span>
          {actionLabel && onActivate ? (
            <>
              <span className="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                tabIndex={-1}
                title={actionName}
                aria-label={actionName}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPreserveFocus();
                }}
                onKeyDown={handleEmbeddedKeyDown}
                onClick={(event) => onActivate(event.currentTarget)}
                className="rounded px-0.5 font-medium text-foreground/80 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {actionLabel}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "mx-2 my-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
            tone === "error" && "border border-destructive/30 text-destructive",
            tone === "stale" && "text-amber-700 dark:text-amber-300",
            tone === "default" && "bg-black/[0.03] dark:bg-white/[0.04]",
          )}
          style={{ paddingLeft: `${sidebarTreeIndent(level)}px` }}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {actionLabel && onActivate && actionLabel === label ? null : <span>{label}</span>}
            {actionLabel && onActivate ? (
              <button
                type="button"
                tabIndex={-1}
                title={actionName}
                aria-label={actionName}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPreserveFocus();
                }}
                onKeyDown={handleEmbeddedKeyDown}
                onClick={(event) => onActivate(event.currentTarget)}
                className={cn(
                  "rounded px-1.5 py-1 font-medium text-foreground hover:bg-muted",
                  actionLabel === label &&
                    "w-full justify-start px-0 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground",
                )}
              >
                {actionLabel}
              </button>
            ) : null}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
