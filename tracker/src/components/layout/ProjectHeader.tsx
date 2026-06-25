import { AlertTriangle, BookOpen, LayoutDashboard, List, RefreshCw } from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewIssueMenu } from "@/components/issues/NewIssueMenu";
import { cn } from "@/lib/utils";
import { kbProjectPath } from "@/lib/kbRoutes";
import { workspaceBasePath } from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";
import type { ProjectSyncState, TrackerKind } from "@/types/project";

interface ProjectHeaderProps {
  projectSlug: string;
  title?: string;
  rightSlot?: ReactNode;
  trackerKind?: TrackerKind;
  syncState?: ProjectSyncState | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  pollingActive?: boolean;
  onIssueCreated?: (issue: Issue) => void;
}

function formatTimeAgo(iso: string | null, t: TFunction): string | null {
  if (!iso) return null;
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return t("layout.projectHeader.lessThanMinute");
  if (minutes < 60) return t("layout.projectHeader.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("layout.projectHeader.hoursAgo", { count: hours });
  return new Date(timestamp).toLocaleString();
}

function syncErrorTitle(syncState: ProjectSyncState, t: TFunction): string {
  const lines = [t("layout.projectHeader.syncErrorTitle")];
  if (syncState.lastError) lines.push(t("layout.projectHeader.lastError", { error: syncState.lastError }));
  const lastOk = formatTimeAgo(syncState.lastPullAt, t);
  if (lastOk) lines.push(t("layout.projectHeader.lastSync", { when: lastOk }));
  return lines.join("\n");
}

export function ProjectHeader({
  projectSlug,
  title,
  rightSlot,
  trackerKind,
  syncState,
  onRefresh,
  refreshing = false,
  pollingActive = true,
  onIssueCreated,
}: ProjectHeaderProps) {
  const { t } = useTranslation();
  const pollingLabel = pollingActive
    ? t("layout.projectHeader.pollingActive")
    : t("layout.projectHeader.pollingPaused");
  const remoteTracker = trackerKind != null && trackerKind !== "local";
  const syncFailing = remoteTracker && syncState?.status === "error";
  const syncErrorLabel = t("layout.projectHeader.syncError");

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
      <NavLink
        to={workspaceBasePath(projectSlug, "board")}
        className="group rounded-md outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <h1 className="text-base font-semibold group-hover:underline">{title ?? projectSlug}</h1>
        <p className="text-xs text-muted-foreground group-hover:text-primary">{projectSlug}</p>
      </NavLink>
      <div className="flex items-center gap-2">
        {refreshing ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t("layout.projectHeader.refreshing")}
          </span>
        ) : null}
        {syncFailing && syncState ? (
          <Badge
            variant="destructive"
            role="status"
            aria-label={syncErrorLabel}
            title={syncErrorTitle(syncState, t)}
            className="gap-1"
          >
            <AlertTriangle className="h-3 w-3" />
            {syncErrorLabel}
          </Badge>
        ) : null}
        {remoteTracker ? (
          <div className="flex items-center gap-2">
            <Badge variant="muted">{t(`layout.projectHeader.trackers.${trackerKind}`)}</Badge>
            <span
              role="status"
              aria-label={pollingLabel}
              title={pollingLabel}
              className={cn(
                "h-2 w-2 rounded-full",
                pollingActive ? "bg-green-500" : "bg-muted-foreground",
              )}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              aria-label={t("layout.projectHeader.refreshBoard")}
              disabled={refreshing}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        ) : null}
        {rightSlot}
        <Button variant="ghost" size="sm" asChild>
          <NavLink
            to={workspaceBasePath(projectSlug, "board")}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <LayoutDashboard className="h-4 w-4" />
            {t("layout.projectHeader.board")}
          </NavLink>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <NavLink
            to={workspaceBasePath(projectSlug, "list")}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <List className="h-4 w-4" />
            {t("layout.projectHeader.list")}
          </NavLink>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <NavLink
            to={kbProjectPath(projectSlug)}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <BookOpen className="h-4 w-4" />
            {t("layout.projectHeader.knowledgeBase")}
          </NavLink>
        </Button>
        <NewIssueMenu projectSlug={projectSlug} size="sm" onCreated={onIssueCreated} />
      </div>
    </header>
  );
}
