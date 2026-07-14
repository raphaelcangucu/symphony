import { ChevronDown, ChevronRight } from "lucide-react";

import { WorkspaceDetailPane } from "@/components/sessions/WorkspaceDetailPane";
import { WorkspaceListRow } from "@/components/sessions/WorkspaceListRow";
import { WorkspaceRowMenu } from "@/components/sessions/WorkspaceRowMenu";
import { cn } from "@/lib/utils";
import type { ProjectSessionRow } from "@/lib/projectSessions";
import type { WorkspaceListItem } from "@/lib/workspaceCards";
import type { RecentSession } from "@/types/recents";

interface WorkspaceAccordionItemProps {
  item: WorkspaceListItem;
  expanded: boolean;
  issueHref: string | null;
  resumePending?: boolean;
  archiving?: boolean;
  onToggle(): void;
  onOpenExecution?(session: ProjectSessionRow): void;
  onOpenAuthoring?(issueIdentifier: string): void;
  onOpenSession?(session: RecentSession): void;
  onOpenAssistantSession?(threadId: number, title: string): void;
  onResume?(session: ProjectSessionRow): void;
  onNewSession?(issueIdentifier: string): void;
  onRemove?(path: string): void;
  onArchive?(threadId: number): void;
}

export function WorkspaceAccordionItem({
  item,
  expanded,
  issueHref,
  resumePending = false,
  archiving = false,
  onToggle,
  onOpenExecution,
  onOpenAuthoring,
  onOpenSession,
  onOpenAssistantSession,
  onResume,
  onNewSession,
  onRemove,
  onArchive,
}: WorkspaceAccordionItemProps) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-stretch gap-0.5">
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={onToggle}
          className="inline-flex h-[auto] w-4 shrink-0 items-center justify-center self-center text-muted-foreground/60 hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" strokeWidth={1.5} aria-hidden />
          ) : (
            <ChevronRight className="h-3 w-3" strokeWidth={1.5} aria-hidden />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <WorkspaceListRow item={item} selected={expanded} onSelect={onToggle} />
        </div>
        <div className="flex shrink-0 items-center self-center pr-0.5">
          <WorkspaceRowMenu
            item={item}
            issueHref={issueHref}
            resumePending={resumePending}
            onOpenExecution={onOpenExecution}
            onOpenAuthoring={onOpenAuthoring}
            onOpenSession={onOpenSession}
            onOpenAssistantSession={onOpenAssistantSession}
            onResume={onResume}
            onNewSession={onNewSession}
            onRemove={onRemove}
            onArchive={onArchive}
          />
        </div>
      </div>
      {expanded ? (
        <div
          id={`workspace-accordion-${item.key}`}
          className={cn("ml-4 rounded-md border border-border/60 bg-muted/20 p-3")}
        >
          <WorkspaceDetailPane
            item={item}
            issueHref={issueHref}
            resumePending={resumePending}
            archiving={archiving}
            embedded
            onOpenExecution={onOpenExecution}
            onOpenAuthoring={onOpenAuthoring}
            onOpenSession={onOpenSession}
            onOpenAssistantSession={onOpenAssistantSession}
            onResume={onResume}
            onNewSession={onNewSession}
            onRemove={onRemove}
            onArchive={onArchive}
          />
        </div>
      ) : null}
    </div>
  );
}
