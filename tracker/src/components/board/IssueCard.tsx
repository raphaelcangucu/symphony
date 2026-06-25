import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { AlertTriangle, ExternalLink, GitBranch, GitFork, Layers, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentLongRunningBadge, AgentStatusDot, agentStatusLabel } from "@/components/issues/AgentStatusBadge";
import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { PriorityIndicator } from "@/components/issues/PriorityIndicator";
import { executionNeedsAttention, resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { issueDragId } from "./board-utils";
import { GroupDropOverlay, ReorderDropLine } from "./GroupDropOverlay";
import { labelDotClass } from "./label-colors";

interface IssueCardProps {
  issue: Issue;
  onSelect: (issue: Issue) => void;
  agent?: AgentExecution;
  dragOverlay?: boolean;
  mergeActive?: boolean;
  dropEdge?: "top" | "bottom" | null;
  /**
   * Render as a non-draggable card. Used for the lead inside a group so the
   * group is the single draggable unit (otherwise the lead's own sortable would
   * shadow the group's, letting the lead move out on its own).
   */
  presentational?: boolean;
}

export function IssueCard({
  issue,
  onSelect,
  agent,
  dragOverlay = false,
  mergeActive = false,
  dropEdge = null,
  presentational = false,
}: IssueCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issueDragId(issue.identifier),
    disabled: dragOverlay || presentational,
  });

  const interactive = !presentational;
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: "none",
  } satisfies React.CSSProperties;

  const isBlocked = issue.blockedBy.length > 0;
  const displayStatus = agent ? resolveDisplayStatus(agent) : null;
  const agentNeedsAttention = agent ? executionNeedsAttention(agent) : false;
  const agentStatusTitle =
    agent?.error ??
    (displayStatus ? t("board.issueCard.agentStatus", { status: agentStatusLabel(displayStatus, t) }) : undefined);

  return (
    <article
      ref={interactive ? setNodeRef : undefined}
      style={interactive ? style : undefined}
      className={cn(
        "group relative cursor-pointer rounded-xl border border-border/70 bg-card p-3 shadow-sm transition-all",
        interactive && "cursor-grab active:cursor-grabbing hover:-translate-y-px hover:border-primary/40 hover:shadow-md",
        agentNeedsAttention && "border-rose-500/40 ring-1 ring-rose-500/20",
        mergeActive && "border-primary ring-2 ring-primary ring-offset-1 ring-offset-background",
        interactive && isDragging && "opacity-40",
        dragOverlay && "w-72 rotate-3 shadow-2xl ring-1 ring-border",
      )}
      {...(interactive ? attributes : {})}
      {...(interactive ? listeners : {})}
      onClick={() => onSelect(issue)}
    >
      {mergeActive ? <GroupDropOverlay /> : null}
      {dropEdge && !mergeActive ? <ReorderDropLine edge={dropEdge} /> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {issue.identifier}
        </span>
        <div className="flex items-center gap-1.5">
          {issue.url ? (
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(event) => event.stopPropagation()}
              aria-label={t("board.issueCard.openOnTracker")}
              title={t("board.issueCard.openOnTracker")}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <PriorityIndicator priority={issue.priority} />
        </div>
      </div>

      <h3 className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">{issue.title}</h3>

      {issue.description ? (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{issue.description}</p>
      ) : null}

      {issue.branchName ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{issue.branchName}</span>
          </span>
        </div>
      ) : null}

      {issue.repositoryFullName || issue.subIssueSummary ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {issue.repositoryFullName ? (
            <span
              title={issue.repositoryFullName}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              <GitFork className="h-3 w-3 shrink-0" />
              <span className="truncate">{issue.repositoryFullName}</span>
            </span>
          ) : null}
          {issue.subIssueSummary ? (
            <span
              title={`${issue.subIssueSummary.completed} / ${issue.subIssueSummary.total}`}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              <Layers className="h-3 w-3 shrink-0" />
              {issue.subIssueSummary.completed} / {issue.subIssueSummary.total}
            </span>
          ) : null}
        </div>
      ) : null}

      {agent?.longRunning ? (
        <div className="mt-2.5">
          <AgentLongRunningBadge execution={agent} compact />
        </div>
      ) : null}

      {issue.labels.length > 0 || isBlocked ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {isBlocked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              {t("board.issueCard.blocked")}
            </span>
          ) : null}
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              title={label}
              className="inline-flex max-w-[9rem] items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", labelDotClass(label))} />
              <span className="truncate">{label}</span>
            </span>
          ))}
          {issue.labels.length > 3 ? (
            <span className="text-[10px] font-medium text-muted-foreground">+{issue.labels.length - 3}</span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          {agent ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                agentNeedsAttention && "text-rose-600 dark:text-rose-300",
              )}
              title={agentStatusTitle}
            >
              <AgentStatusDot status={displayStatus!} />
              {agentStatusLabel(displayStatus!, t)}
            </span>
          ) : null}
          {isBlocked ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {issue.blockedBy.length}
            </span>
          ) : null}
        </div>
        <AssigneeAvatar login={issue.assignee} />
      </div>
    </article>
  );
}
