import type { Issue } from "@/types/issue";

interface AgentTabProps {
  issue: Issue;
}

export function AgentTab({ issue }: AgentTabProps) {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border p-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assignment</div>
        <div className="mt-2">{issue.assignee || "No agent assigned"}</div>
      </div>
      <p className="text-muted-foreground">Agent controls are read-only in this slice.</p>
    </div>
  );
}
