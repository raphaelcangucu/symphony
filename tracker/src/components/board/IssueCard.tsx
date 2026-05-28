import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";

import { issueDragId } from "./board-utils";

interface IssueCardProps {
  issue: Issue;
  onSelect: (issue: Issue) => void;
  dragOverlay?: boolean;
}

export function IssueCard({ issue, onSelect, dragOverlay = false }: IssueCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issueDragId(issue.identifier),
    disabled: dragOverlay,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: "none",
  } satisfies React.CSSProperties;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        "group rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/30 hover:shadow-md",
        isDragging && "opacity-40",
        dragOverlay && "w-72 rotate-1 shadow-lg",
      )}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(issue)}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold text-muted-foreground">{issue.identifier}</div>
          <h3 className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{issue.title}</h3>
        </div>
        {issue.priority !== null ? <Badge variant="outline">P{issue.priority}</Badge> : null}
      </div>
      {issue.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{issue.description}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {issue.blockedBy.length > 0 ? (
          <Badge variant="secondary" className="gap-1 bg-amber-500/10 text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            Blocked
          </Badge>
        ) : null}
        {issue.labels.slice(0, 3).map((label) => (
          <Badge key={label} variant="muted" className="text-[10px]">
            {label}
          </Badge>
        ))}
      </div>
    </article>
  );
}
