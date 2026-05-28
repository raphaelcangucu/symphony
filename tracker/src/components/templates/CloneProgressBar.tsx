import { Button } from "@/components/ui/button";
import type { CloneProgressState } from "@/hooks/useCloneProgress";

interface CloneProgressBarProps {
  state: CloneProgressState;
  onRetry: (repositoryId: string) => void;
}

export function CloneProgressBar({ state, onRetry }: CloneProgressBarProps) {
  const jobs = Object.values(state.jobs);
  if (jobs.length === 0 || (state.allSucceeded && !state.anyFailed)) return null;

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <p className="font-medium">
        {state.anyFailed ? "Some repositories failed to clone" : `Cloning repositories (${state.inProgressCount} in progress)`}
      </p>
      <ul className="mt-2 space-y-1">
        {jobs.map((job) => (
          <li key={job.repositoryId} className="flex items-center justify-between gap-2">
            <span className="truncate">{job.githubFullName ?? job.repositoryId}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{job.status}</span>
              {job.status === "failed" ? (
                <Button size="sm" variant="ghost" onClick={() => onRetry(job.repositoryId)}>
                  Retry
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
