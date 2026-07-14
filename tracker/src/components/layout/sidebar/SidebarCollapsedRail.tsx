import { Bot, FolderKanban, Plus, Search, Settings } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { aggregateStatusLabel } from "@/components/layout/sidebar/ProjectTreeItem";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SidebarRouteSelection } from "@/lib/sidebarRouteResolution";
import { cn } from "@/lib/utils";
import type { RecentStatusKind } from "@/types/recents";
import type { SidebarAggregateStatus, SidebarProjectNode } from "@/types/sidebar";

export interface SidebarCollapsedRailProps {
  readonly tree: readonly SidebarProjectNode[];
  readonly selection: SidebarRouteSelection;
  readonly className?: string;
  onNewSession(): void;
  onSearch(): void;
  onOpenProject(href: string): void;
}

export function SidebarCollapsedRail({
  tree,
  selection,
  className,
  onNewSession,
  onSearch,
  onOpenProject,
}: SidebarCollapsedRailProps) {
  const { t } = useTranslation();
  const currentProject = useMemo(() => {
    if (!selection.projectSlug) return null;
    return tree.find((project) => project.projectSlug === selection.projectSlug) ?? null;
  }, [selection.projectSlug, tree]);

  const currentTooltip = currentProject
    ? `${currentProject.title} · ${aggregateStatusLabel(currentProject.aggregateStatus, t)}`
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label={t("layout.sidebar.collapsed.label")}
        className={cn("flex min-h-0 flex-1 flex-col items-center gap-2", className)}
      >
        <RailIconButton
          label={t("layout.sidebar.utility.newSession")}
          onClick={onNewSession}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </RailIconButton>
        <RailIconButton
          label={t("layout.sidebar.utility.search")}
          onClick={onSearch}
        >
          <Search className="h-4 w-4" aria-hidden />
        </RailIconButton>
        <RailIconLink
          label={t("layout.sidebar.utility.automations")}
          to="/settings/templates"
        >
          <Bot className="h-4 w-4" aria-hidden />
        </RailIconLink>
        <RailIconLink label={t("layout.sidebar.utility.settings")} to="/settings">
          <Settings className="h-4 w-4" aria-hidden />
        </RailIconLink>

        <div className="my-1 h-px w-6 bg-border" aria-hidden />

        {currentProject ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={currentProject.href}
                title={currentTooltip ?? currentProject.title}
                aria-label={currentTooltip ?? currentProject.title}
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-md border text-sm font-semibold uppercase",
                  "text-muted-foreground hover:bg-accent hover:text-foreground",
                  "bg-accent text-foreground",
                )}
                onClick={(event) => {
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onOpenProject(currentProject.href);
                }}
              >
                {currentProject.title.charAt(0) || <FolderKanban className="h-4 w-4" />}
                <span className="absolute -right-0.5 -top-0.5">
                  <RecentStatusDot statusKind={aggregateStatusKind(currentProject.aggregateStatus)} />
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{currentTooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </nav>
    </TooltipProvider>
  );
}

function RailIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          aria-label={label}
          title={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailIconLink({
  label,
  to,
  children,
}: {
  label: string;
  to: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground">
          <Link to={to} aria-label={label} title={label}>
            {children}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function aggregateStatusKind(status: SidebarAggregateStatus): RecentStatusKind {
  switch (status) {
    case "active":
      return "active";
    case "attention":
      return "waiting";
    case "error":
      return "error";
    case "stale":
      return "idle";
    case "idle":
    default:
      return "idle";
  }
}
