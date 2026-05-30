import { GitPullRequest, RefreshCw } from "lucide-react";

import { PullRequestPanel } from "@/components/issues/pull-request/PullRequestPanel";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";
import type { PullRequest } from "@/types/pull-request";

interface PullRequestTabProps {
  issue: Issue;
  pullRequests: PullRequest[];
  supported: boolean;
  available: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function PullRequestTab({
  issue,
  pullRequests,
  supported,
  available,
  loading,
  error,
  onRefresh,
}: PullRequestTabProps) {
  if (!supported) {
    return (
      <EmptyState>
        Pull request linkage is only available for GitHub-backed projects.
        {issue.url ? (
          <>
            {" "}
            <a href={issue.url} target="_blank" rel="noreferrer noopener" className="underline">
              Open the issue
            </a>{" "}
            to see related work.
          </>
        ) : null}
      </EmptyState>
    );
  }

  if (!available) {
    return <EmptyState>A GitHub token is required to load pull request and CI details.</EmptyState>;
  }

  if (loading && pullRequests.length === 0) {
    return <EmptyState>Loading pull request details…</EmptyState>;
  }

  if (error && pullRequests.length === 0) {
    return (
      <EmptyState>
        {error}{" "}
        <button type="button" onClick={onRefresh} className="underline">
          Retry
        </button>
      </EmptyState>
    );
  }

  if (pullRequests.length === 0) {
    return (
      <EmptyState>
        No pull request linked to this issue yet. Once an agent opens a PR that references{" "}
        <span className="font-mono">{issue.identifier}</span> (or uses its linked branch), it will appear here.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {pullRequests.length} related pull request{pullRequests.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>
      {pullRequests.map((pr) => (
        <PullRequestPanel key={pr.number} pullRequest={pr} />
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <GitPullRequest className="h-5 w-5" />
      <p>{children}</p>
    </div>
  );
}
