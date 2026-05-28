import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { IssueCard } from "./IssueCard";
import { issueDragId } from "./board-utils";

interface BoardColumnProps {
  status: WorkflowStatusName;
  issues: Issue[];
  onSelectIssue: (issue: Issue) => void;
}

export function BoardColumn({ status, issues, onSelectIssue }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section className="flex h-full w-80 shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{status}</h2>
        <Badge variant="muted">{issues.length}</Badge>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-80 flex-1 rounded-xl border bg-muted/30 p-3 transition-colors",
          isOver && "border-primary/40 bg-muted/60 ring-2 ring-primary/10",
        )}
      >
        <SortableContext items={issues.map((issue) => issueDragId(issue.identifier))} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5">
            {issues.map((issue) => (
              <IssueCard key={issue.identifier} issue={issue} onSelect={onSelectIssue} />
            ))}
          </div>
        </SortableContext>
        {issues.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            Drop here
          </div>
        ) : null}
      </div>
    </section>
  );
}
