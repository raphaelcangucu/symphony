import { LayoutDashboard, List, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { IssueCreateDialog } from "@/components/issues/IssueCreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";
import type { TrackerKind } from "@/types/project";

const TRACKER_LABELS: Record<Exclude<TrackerKind, "local">, string> = {
  github: "GitHub Project",
  linear: "Linear",
};

interface ProjectHeaderProps {
  projectSlug: string;
  title?: string;
  onIssueCreated?: (issue: Issue) => void;
  rightSlot?: ReactNode;
  trackerKind?: TrackerKind;
  onRefresh?: () => void;
}

export function ProjectHeader({
  projectSlug,
  title,
  onIssueCreated,
  rightSlot,
  trackerKind,
  onRefresh,
}: ProjectHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur">
      <div>
        <h1 className="text-base font-semibold">{title ?? projectSlug}</h1>
        <p className="text-xs text-muted-foreground">{projectSlug}</p>
      </div>
      <div className="flex items-center gap-2">
        {trackerKind != null && trackerKind !== "local" ? (
          <div className="flex items-center gap-2">
            <Badge variant="muted">{TRACKER_LABELS[trackerKind]}</Badge>
            <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="Refresh board">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {rightSlot}
        <Button variant="ghost" size="sm" asChild>
          <NavLink
            to={`/projects/${projectSlug}/board`}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <LayoutDashboard className="h-4 w-4" />
            Board
          </NavLink>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <NavLink
            to={`/projects/${projectSlug}/list`}
            className={({ isActive }) => cn(isActive && "bg-accent text-foreground")}
          >
            <List className="h-4 w-4" />
            List
          </NavLink>
        </Button>
        <IssueCreateDialog projectSlug={projectSlug} onCreated={onIssueCreated} />
      </div>
    </header>
  );
}
