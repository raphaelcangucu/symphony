import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  WorkspaceIconButton,
  workspaceMenuIconProps,
} from "@/components/sessions/WorkspaceActionButton";
import { WorkspaceDetailPane } from "@/components/sessions/WorkspaceDetailPane";
import { WorkspaceListRow } from "@/components/sessions/WorkspaceListRow";
import { WorkspaceRowMenu } from "@/components/sessions/WorkspaceRowMenu";
import { cn } from "@/lib/utils";
import type { ProjectSessionRow } from "@/lib/projectSessions";
import {
  countLiveWritersForWorkspace,
  isWorkspaceRemovable,
  type WorkspaceCard,
  type WorkspaceListItem,
} from "@/lib/workspaceCards";
import type { RecentSession } from "@/types/recents";

interface WorkspaceAccordionItemProps {
  item: WorkspaceListItem;
  expanded: boolean;
  issueHref: string | null;
  resumePending?: boolean;
  archiving?: boolean;
  onToggle(): void;
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
  onOpenSession,
  onOpenAssistantSession,
  onResume,
  onNewSession,
  onRemove,
  onArchive,
}: WorkspaceAccordionItemProps) {
  const { t } = useTranslation();
  const removable =
    item.kind === "card" && onRemove && isWorkspaceRemovable(item.card);
  const liveWriterCount =
    item.kind === "card" ? liveWritersForCard(item.card) : 0;

  return (
    <div className="space-y-0.5">
      <div className="group flex items-stretch gap-0.5">
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={onToggle}
          className="inline-flex h-auto w-4 shrink-0 items-center justify-center self-center text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <WorkspaceListRow
            item={item}
            selected={expanded}
            onSelect={onToggle}
            onOpenChat={
              onOpenAssistantSession
                ? (session) => {
                    if (session.threadId == null) return;
                    onOpenAssistantSession(session.threadId, session.title);
                  }
                : undefined
            }
          />
          {liveWriterCount > 1 ? (
            <p className="mt-0.5 pl-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              {t("workspacesPage.concurrentWriters", { count: liveWriterCount })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 self-center pr-0.5">
          {removable ? (
            <WorkspaceIconButton
              label={t("workspacesPage.removeWorkspace.aria", {
                defaultValue: "Remove workspace",
              })}
              className={cn(
                "text-muted-foreground/70 opacity-0 hover:bg-destructive/10 hover:text-destructive",
                "focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(item.card.inventory!.path);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Trash2 {...workspaceMenuIconProps} className="h-3.5 w-3.5" aria-hidden />
            </WorkspaceIconButton>
          ) : null}
          <WorkspaceRowMenu
            item={item}
            issueHref={issueHref}
            resumePending={resumePending}
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
          className={cn("ml-4 rounded-md border border-border/60 bg-muted/20 p-2")}
        >
          <WorkspaceDetailPane
            item={item}
            issueHref={issueHref}
            archiving={archiving}
            embedded
            onOpenSession={onOpenSession}
            onOpenAssistantSession={onOpenAssistantSession}
            onNewSession={onNewSession}
            onRemove={onRemove}
            onArchive={onArchive}
          />
        </div>
      ) : null}
    </div>
  );
}

function liveWritersForCard(card: WorkspaceCard): number {
  const workspacePath = card.inventory?.path?.trim() ?? "";
  if (!workspacePath) return 0;

  const sessions: Array<{ workspacePath: string | null; aggregateStatus: string }> = [
    ...card.sessions.map((session) => ({
      workspacePath,
      aggregateStatus: session.statusKind,
    })),
  ];
  if (card.execution) {
    sessions.push({ workspacePath, aggregateStatus: card.execution.status });
  }
  return countLiveWritersForWorkspace(sessions, workspacePath);
}
