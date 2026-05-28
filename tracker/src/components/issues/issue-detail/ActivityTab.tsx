import type { Issue } from "@/types/issue";

interface ActivityTabProps {
  issue: Issue;
}

export function ActivityTab({ issue }: ActivityTabProps) {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      Activity stream for {issue.identifier} will populate from tracker events as the backend exposes history.
    </div>
  );
}
