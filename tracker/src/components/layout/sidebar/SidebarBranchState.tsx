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
      <SidebarPseudoTreeItem
        id={id}
        level={2}
        label={label}
        tabIndex={tabIndex}
        rowRef={rowRef}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onPreserveFocus={onPreserveFocus}
      >
        <div aria-hidden="true" className="space-y-1 py-1">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-5 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </SidebarPseudoTreeItem>
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
  const label = stale
    ? t("layout.sidebar.tree.stale", { defaultValue: "Stale data" })
    : t("layout.sidebar.tree.emptyProject", {
        project: project.title,
        defaultValue: "No workspaces in {{project}}",
      });
  const actionLabel = stale
    ? undefined
    : t("layout.sidebar.tree.createWorkspace", {
        project: project.title,
        defaultValue: "Create workspace in {{project}}",
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
      onActivate={stale ? undefined : onActivate}
      onPreserveFocus={onPreserveFocus}
      tone={stale ? "stale" : "default"}
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
  tone?: "default" | "error" | "stale";
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
  tone = "default",
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
  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={level}
      aria-label={label}
      aria-expanded={expanded}
      tabIndex={tabIndex}
      title={label}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className="outline-none"
      data-sidebar-tree-row-id={id}
    >
      <div
        className={cn(
          "mx-1 my-0.5 rounded px-2 py-1 text-xs text-muted-foreground",
          tone === "error" && "border border-destructive/30 text-destructive",
          tone === "stale" && "text-amber-700 dark:text-amber-300",
        )}
        style={{ paddingLeft: `${sidebarTreeIndent(level)}px` }}
      >
        <span>{label}</span>
        {actionLabel && onActivate ? (
          <button
            type="button"
            tabIndex={-1}
            title={actionLabel}
            aria-label={actionLabel}
            onMouseDown={(event) => {
              event.preventDefault();
              onPreserveFocus();
            }}
            onKeyDown={handleEmbeddedKeyDown}
            onClick={(event) => onActivate(event.currentTarget)}
            className="ml-2 rounded px-1.5 py-1 font-medium text-foreground hover:bg-muted"
          >
            {actionLabel}
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
