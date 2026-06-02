import { useState } from "react";
import { GitPullRequest, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";

import { hasFailingChecks } from "@/components/issues/pull-request/pr-meta";
import { PullRequestPanel } from "@/components/issues/pull-request/PullRequestPanel";
import { linkPullRequest, requestPullRequestFix, unlinkPullRequest } from "@/services/pullRequests";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";
import type { PullRequest } from "@/types/pull-request";

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
  const [linkUrl, setLinkUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const canFix = pullRequests.some(hasFailingChecks);

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

  const linkRow = (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={linkUrl}
        onChange={(event) => setLinkUrl(event.target.value)}
        placeholder="https://github.com/owner/repo/pull/123"
        className="flex-1 rounded-md border px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={() => void handleLink()}
        disabled={linking || !linkUrl.trim()}
        className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
      >
        {linking ? "Linking…" : "Link PR"}
      </button>
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
            <button
              type="button"
              onClick={() => void handleFix()}
              disabled={fixing}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 disabled:opacity-60 dark:text-amber-300"
            >
              <Wrench className={cn("h-3.5 w-3.5", fixing && "animate-pulse")} />
              {fixing ? "Sending…" : "Fix with agent"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>
      {linkRow}
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <GitPullRequest className="h-5 w-5" />
      <p>{children}</p>
    </div>
  );
}
