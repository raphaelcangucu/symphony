import { useState } from "react";
import { GitPullRequest, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import { toast } from "sonner";

import { hasFailingChecks } from "@/components/issues/pull-request/pr-meta";
import { PullRequestPanel } from "@/components/issues/pull-request/PullRequestPanel";
import { Button } from "@/components/ui/button";
import { linkPullRequest, requestPullRequestFix, rerunFailedJobs, unlinkPullRequest } from "@/services/pullRequests";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";
import type { PullRequest, PullRequestMonitorInfo, RerunResult } from "@/types/pull-request";

interface PullRequestTabProps {
  issue: Issue;
  projectSlug: string;
  pullRequests: PullRequest[];
  supported: boolean;
  available: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function PullRequestTab({
  issue,
  projectSlug,
  pullRequests,
  supported,
  available,
  loading,
  error,
  onRefresh,
}: PullRequestTabProps) {
  const [fixing, setFixing] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const canFix = pullRequests.some(hasFailingChecks);
  const monitorEntries = pullRequests
    .filter((pr) => pr.monitor?.lastAction)
    .map((pr) => ({ pr, monitor: pr.monitor! }));

  async function handleFix() {
    if (fixing) return;
    setFixing(true);
    try {
      const result = await requestPullRequestFix(projectSlug, issue.identifier);
      toast.success(`Sent to ${result.movedTo} — the agent will pick it up on the next poll.`);
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not request a fix.");
    } finally {
      setFixing(false);
    }
  }

  async function handleRerun() {
    if (rerunning) return;
    setRerunning(true);
    try {
      const failing = pullRequests.filter(hasFailingChecks);
      const results: RerunResult[] = [];
      for (const pr of failing) {
        results.push(...(await rerunFailedJobs(projectSlug, issue.identifier, pr.number)));
      }
      if (results.some((result) => result.ok === false)) {
        toast.error("Some jobs could not be re-run. Refresh in a minute to see results.");
      } else {
        toast.success("Failed jobs were re-run. Refresh in a minute to see results.");
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not re-run the failed jobs.");
    } finally {
      setRerunning(false);
      onRefresh();
    }
  }

  async function handleLink() {
    if (linking || !linkUrl.trim()) return;
    setLinking(true);
    try {
      await linkPullRequest(projectSlug, issue.identifier, linkUrl);
      setLinkUrl("");
      toast.success("Pull request linked.");
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not link the pull request.");
    } finally {
      setLinking(false);
    }
  }

  async function handleRemove(url: string | null) {
    if (!url) return;
    try {
      await unlinkPullRequest(projectSlug, issue.identifier, url);
      toast.success("Pull request unlinked.");
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not unlink the pull request.");
    }
  }

  const refreshButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onRefresh}
      disabled={loading}
      className="text-muted-foreground"
    >
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
      Refresh
    </Button>
  );

  const linkRow = (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={linkUrl}
        onChange={(event) => setLinkUrl(event.target.value)}
        placeholder="https://github.com/owner/repo/pull/123"
        className="h-8 flex-1 rounded-md border px-3 text-xs"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void handleLink()}
        disabled={linking || !linkUrl.trim()}
        className="shrink-0 text-muted-foreground"
      >
        {linking ? "Linking…" : "Link PR"}
      </Button>
    </div>
  );

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
      <div className="space-y-4">
        <div className="flex items-center justify-end">{refreshButton}</div>
        <EmptyState>
          No pull request linked to this issue yet. Once an agent opens a PR that references{" "}
          <span className="font-mono">{issue.identifier}</span> (or uses its linked branch), it will appear here.
          You can also link one manually below (e.g. a PR in another repository).
        </EmptyState>
        {linkRow}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {pullRequests.length} related pull request{pullRequests.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          {canFix ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRerun()}
                disabled={rerunning}
                className="text-muted-foreground"
              >
                <RotateCcw aria-hidden="true" className={cn("h-4 w-4", rerunning && "animate-spin")} />
                {rerunning ? "Re-running…" : "Re-run failed jobs"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleFix()}
                disabled={fixing}
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-300"
              >
                <Wrench className={cn("h-4 w-4", fixing && "animate-pulse")} />
                {fixing ? "Sending…" : "Fix with agent"}
              </Button>
            </>
          ) : null}
          {refreshButton}
        </div>
      </div>
      {linkRow}
      {monitorEntries.map(({ pr, monitor }) => (
        <div
          key={`monitor-${pr.number}`}
          className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-muted-foreground"
        >
          <span className="font-medium text-foreground">{monitorLabel(monitor)}</span>
          {monitor.summary ? <> — {monitor.summary}</> : null}
        </div>
      ))}
      {pullRequests.map((pr) => (
        <PullRequestPanel
          key={pr.url ?? `${pr.repo}#${pr.number}`}
          pullRequest={pr}
          projectSlug={projectSlug}
          issueIdentifier={issue.identifier}
          onRefresh={onRefresh}
          onRemove={pr.origin === "manual" ? () => void handleRemove(pr.url) : undefined}
        />
      ))}
    </div>
  );
}

function monitorLabel(monitor: PullRequestMonitorInfo): string {
  switch (monitor.lastAction) {
    case "moved_to_rework":
      return `CI/review failure attributed to this PR — sent to Rework (attempt ${Math.max(1, monitor.autoReworkCount)})`;
    case "moved_to_done":
      return "PR merged — issue moved to Done";
    case "kept_human_review":
      return "Kept in review — failure looks unrelated or needs a human";
    case "limit_reached":
      return "Automatic fix limit reached — human review required";
    default:
      return `Monitor: ${monitor.lastAction ?? "status"}`;
  }
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <GitPullRequest className="h-5 w-5" />
      <p>{children}</p>
    </div>
  );
}
