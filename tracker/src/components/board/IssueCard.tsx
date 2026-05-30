import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { AlertTriangle, ExternalLink, GitBranch, MessageSquare } from "lucide-react";

import { AgentStatusDot, agentStatusLabel } from "@/components/issues/AgentStatusBadge";
import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { PriorityIndicator } from "@/components/issues/PriorityIndicator";
import { cn } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

import { issueDragId } from "./board-utils";
import { labelDotClass } from "./label-colors";

interface IssueCardProps {
  issue: Issue;
  onSelect: (issue: Issue) => void;
  agent?: AgentExecution;
  dragOverlay?: boolean;
}

export function IssueCard({ issue, onSelect, agent, dragOverlay = false }: IssueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issueDragId(issue.identifier),
    disabled: dragOverlay,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: "none",
  } satisfies React.CSSProperties;

  const isBlocked = issue.blockedBy.length > 0;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        "group cursor-pointer rounded-xl border border-border/70 bg-card p-3 shadow-sm transition-all",
        "hover:-translate-y-px hover:border-primary/40 hover:shadow-md",
        isDragging && "opacity-40",
        dragOverlay && "w-72 rotate-2 shadow-xl ring-2 ring-primary/20",
      )}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(issue)}
    >
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
              aria-label="Open on tracker"
              title="Open on tracker"
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

      {issue.labels.length > 0 || isBlocked ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {isBlocked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              Blocked
            </span>
          ) : null}
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", labelDotClass(label))} />
              {label}
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
            <span className="inline-flex items-center gap-1 font-medium">
              <AgentStatusDot status={agent.status} />
              {agentStatusLabel(agent.status)}
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
