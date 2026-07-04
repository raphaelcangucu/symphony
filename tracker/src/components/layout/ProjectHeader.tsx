import { AlertTriangle, BookOpen, History, LayoutDashboard, List, RefreshCw, TerminalSquare } from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { toast } from "sonner";

import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewIssueMenu } from "@/components/issues/NewIssueMenu";
import { ProjectSwitcher } from "@/components/layout/ProjectSwitcher";
import { cn } from "@/lib/utils";
import { kbProjectPath } from "@/lib/kbRoutes";
import { projectSessionsPath, projectTerminalPath, workspaceBasePath } from "@/lib/workspaceRoutes";
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

// Locale-independent, debug-friendly text so it can be pasted straight into an
// IDE/assistant regardless of the UI language.
function buildSyncErrorReport(
  syncState: ProjectSyncState,
  projectSlug: string,
  trackerKind: TrackerKind | undefined,
): string {
  const lines = ["Symphony sync error"];
  lines.push(`Project: ${projectSlug}${trackerKind ? ` (${trackerKind})` : ""}`);
  lines.push(`Status: ${syncState.status}`);
  if (syncState.lastError) lines.push(`Last error: ${syncState.lastError}`);
  if (syncState.lastPullAt) lines.push(`Last pull: ${syncState.lastPullAt}`);
  if (syncState.lastPushAt) lines.push(`Last push: ${syncState.lastPushAt}`);
  if (syncState.lastFullSyncAt) lines.push(`Last full sync: ${syncState.lastFullSyncAt}`);
  return lines.join("\n");
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the legacy path below (e.g. non-secure contexts).
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
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

  async function handleCopySyncError() {
    if (!syncState) return;
    const report = buildSyncErrorReport(syncState, projectSlug, trackerKind);
    const copied = await copyTextToClipboard(report);
    if (copied) {
      toast.success(t("layout.projectHeader.syncErrorCopied"));
    } else {
      toast.error(t("layout.projectHeader.syncErrorCopyFailed"));
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
      <ProjectSwitcher projectSlug={projectSlug} title={title} />
      <div className="flex items-center gap-2">
        {refreshing ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t("layout.projectHeader.refreshing")}
          </span>
        ) : null}
        {syncFailing && syncState ? (
          <button
            type="button"
            onClick={handleCopySyncError}
            aria-label={syncErrorLabel}
            title={`${syncErrorTitle(syncState, t)}\n\n${t("layout.projectHeader.syncErrorCopyHint")}`}
            className={cn(
              badgeVariants({ variant: "destructive" }),
              "gap-1 cursor-pointer hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {syncErrorLabel}
          </button>
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
            to={projectSessionsPath(projectSlug)}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <History className="h-4 w-4" />
            {t("layout.projectHeader.sessions")}
          </NavLink>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <NavLink
            to={projectTerminalPath(projectSlug)}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <TerminalSquare className="h-4 w-4" />
            {t("layout.projectHeader.terminal")}
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
