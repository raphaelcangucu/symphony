import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/utils";
import type { Issue } from "@/types/issue";

interface SummaryTabProps {
  issue: Issue;
}

export function SummaryTab({ issue }: SummaryTabProps) {
  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3>
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">{issue.description || "No description yet."}</p>
      </section>
      <Separator />
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd className="mt-1"><Badge variant="outline">{issue.status}</Badge></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Priority</dt>
          <dd className="mt-1">{issue.priority === null ? "-" : `P${issue.priority}`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Assignee</dt>
          <dd className="mt-1">{issue.assignee || "Unassigned"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Updated</dt>
          <dd className="mt-1">{formatDateTime(issue.updatedAt)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {issue.labels.length === 0 ? <span className="text-xs text-muted-foreground">No labels</span> : null}
        {issue.labels.map((label) => <Badge key={label} variant="muted">{label}</Badge>)}
      </div>
    </div>
  );
}
