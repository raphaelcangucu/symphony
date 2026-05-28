import type { Issue } from "@/types/issue";

import { IssueRow } from "./IssueRow";

interface ListViewProps {
  issues: Issue[];
  onSelectIssue: (issue: Issue) => void;
}

export function ListView({ issues, onSelectIssue }: ListViewProps) {
  if (issues.length === 0) {
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No issues yet.</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-[7rem_1fr_8rem_8rem] gap-4 border-b bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>ID</span>
        <span>Title</span>
        <span>Status</span>
        <span>Updated</span>
      </div>
      {issues.map((issue) => (
        <IssueRow key={issue.identifier} issue={issue} onSelect={onSelectIssue} />
      ))}
    </div>
  );
}
