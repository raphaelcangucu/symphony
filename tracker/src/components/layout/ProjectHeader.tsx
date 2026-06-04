import { LayoutDashboard, List, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewIssueMenu } from "@/components/issues/NewIssueMenu";
import { cn } from "@/lib/utils";
import { workspaceBasePath } from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";
import type { TrackerKind } from "@/types/project";

const TRACKER_LABELS: Record<Exclude<TrackerKind, "local">, string> = {
  github: "GitHub Project",
  linear: "Linear",
  jira: "Jira",
};

interface ProjectHeaderProps {
  projectSlug: string;
  title?: string;
  rightSlot?: ReactNode;
  trackerKind?: TrackerKind;
  onRefresh?: () => void;
  refreshing?: boolean;
  pollingActive?: boolean;
  onIssueCreated?: (issue: Issue) => void;
}

const POLLING_ACTIVE_LABEL = "Polling active";
const POLLING_PAUSED_LABEL = "Polling paused (window not focused)";

export function ProjectHeader({
  projectSlug,
  title,
  rightSlot,
  trackerKind,
  onRefresh,
  refreshing = false,
  pollingActive = true,
  onIssueCreated,
}: ProjectHeaderProps) {
  const pollingLabel = pollingActive ? POLLING_ACTIVE_LABEL : POLLING_PAUSED_LABEL;
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
      <div>
        <h1 className="text-base font-semibold">{title ?? projectSlug}</h1>
        <p className="text-xs text-muted-foreground">{projectSlug}</p>
      </div>
      <div className="flex items-center gap-2">
        {refreshing ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Syncing
          </span>
        ) : null}
        {trackerKind != null && trackerKind !== "local" ? (
          <div className="flex items-center gap-2">
            <Badge variant="muted">{TRACKER_LABELS[trackerKind]}</Badge>
            <span
              role="status"
              aria-label={pollingLabel}
              title={pollingLabel}
              className={cn(
                "h-2 w-2 rounded-full",
                pollingActive ? "bg-green-500" : "bg-muted-foreground",
              )}
            />
            <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="Refresh board" disabled={refreshing}>
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
            Board
          </NavLink>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <NavLink
            to={workspaceBasePath(projectSlug, "list")}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <List className="h-4 w-4" />
            List
          </NavLink>
        </Button>
        <NewIssueMenu projectSlug={projectSlug} size="sm" onCreated={onIssueCreated} />
      </div>
    </header>
  );
}
