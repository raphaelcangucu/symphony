import { ExternalLink, GitBranch } from "lucide-react";

import { getStatusMeta } from "@/components/board/status-meta";
import { labelDotClass } from "@/components/board/label-colors";
import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { PriorityIndicator, priorityLabel } from "@/components/issues/PriorityIndicator";
import { PullRequestLink } from "@/components/issues/pull-request/PullRequestLink";
import { Markdown } from "@/components/ui/markdown";
import { Separator } from "@/components/ui/separator";
import { useIssueDevServers } from "@/hooks/useIssueDevServers";
import { cn, formatDateTime } from "@/lib/utils";
import type { Comment } from "@/types/comment";
import type { Issue, IssueDevServer, IssueDevServersResponse } from "@/types/issue";
import type { PullRequest } from "@/types/pull-request";

import { CommentCard, WorkpadBadge } from "./CommentCard";

interface SummaryTabProps {
  issue: Issue;
  pullRequests?: PullRequest[];
  workpad?: Comment | null;
  onOpenPullRequest?: () => void;
  onOpenComments?: () => void;
}

function issueLinkLabel(url: string): string {
  if (url.includes("github.com")) return "Open in GitHub";
  if (url.includes("linear.app")) return "Open in Linear";
  return "Open issue";
}

export function SummaryTab({
  issue,
  pullRequests = [],
  workpad = null,
  onOpenPullRequest,
  onOpenComments,
}: SummaryTabProps) {
  const meta = getStatusMeta(issue.status);
  const StatusIcon = meta.Icon;
  const { data: previewData } = useIssueDevServers(issue.projectSlug, issue.identifier);
  const primaryPreviewServer = selectPrimaryPreviewServer(previewData?.servers ?? []);
  const previewUrl = readyPreviewUrl(primaryPreviewServer);
  const previewStatus = previewUrl ? null : previewStatusLabel(previewData, primaryPreviewServer);
  const hasPreviewSummary = Boolean(previewUrl || previewStatus);
  const hasLinks = Boolean(issue.url) || issue.branchName !== null || pullRequests.length > 0 || hasPreviewSummary;

  return (
    <div className="space-y-5 text-sm">
      {hasLinks ? (
        <section className="flex flex-wrap items-center gap-2">
          {issue.url ? (
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {issueLinkLabel(issue.url)}
            </a>
          ) : null}
          {issue.branchName ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 font-mono text-xs text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              {issue.branchName}
            </span>
          ) : null}
          {pullRequests.map((pr) => (
            <PullRequestLink key={pr.number} pullRequest={pr} onOpen={onOpenPullRequest} />
          ))}
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Preview
            </a>
          ) : null}
          {previewStatus ? (
            <span
              role="status"
              aria-live="polite"
              className="inline-flex items-center rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground"
            >
              {previewStatus}
            </span>
          ) : null}
        </section>
      ) : null}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3>
        {issue.description?.trim() ? (
          <Markdown>{issue.description}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">No description yet.</p>
        )}
      </section>
      {workpad ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent Workpad</h3>
          <CommentCard
            author={workpad.author}
            body={workpad.body}
            createdAt={workpad.createdAt}
            url={workpad.url}
            highlight
            badge={<WorkpadBadge />}
            actions={
              onOpenComments ? (
                <button type="button" onClick={onOpenComments} className="text-xs text-primary hover:underline">
                  View all comments
                </button>
              ) : null
            }
          />
        </section>
      ) : null}
      <Separator />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs font-medium">
            <StatusIcon className={cn("h-3.5 w-3.5", meta.iconClass)} />
            {issue.status}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Priority</dt>
          <dd className="mt-1.5 inline-flex items-center gap-1.5 text-sm">
            <PriorityIndicator priority={issue.priority} />
            {priorityLabel(issue.priority)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Assignee</dt>
          <dd className="mt-1.5 inline-flex items-center gap-1.5 text-sm">
            <AssigneeAvatar login={issue.assignee} />
            {issue.assignee || "Unassigned"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Updated</dt>
          <dd className="mt-1.5 text-sm">{formatDateTime(issue.updatedAt)}</dd>
        </div>
      </dl>
      <Separator />
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Labels</h3>
        <div className="flex flex-wrap gap-1.5">
          {issue.labels.length === 0 ? <span className="text-xs text-muted-foreground">No labels</span> : null}
          {issue.labels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-0.5 text-xs font-medium text-foreground"
            >
              <span className={cn("h-2 w-2 rounded-full", labelDotClass(label))} />
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function selectPrimaryPreviewServer(servers: IssueDevServer[]): IssueDevServer | null {
  return servers.find((server) => server.primary) ?? servers.find((server) => server.status === "ready") ?? servers[0] ?? null;
}

function readyPreviewUrl(server: IssueDevServer | null): string | null {
  if (!server || server.status !== "ready" || !server.url) {
    return null;
  }

  return server.url;
}

function previewStatusLabel(
  data: IssueDevServersResponse | null,
  primaryServer: IssueDevServer | null,
): string | null {
  if (!data) {
    return null;
  }

  if (shouldHideUnavailablePreview(data) || !primaryServer) {
    return data.available ? "Preview provisioning..." : null;
  }

  switch (primaryServer.status) {
    case "pending":
    case "provisioning":
      return "Preview provisioning...";
    case "starting":
      return "Preview starting...";
    case "ready":
      return "Preview waiting for URL...";
    case "crashed":
      return "Preview crashed";
    case "stopped":
      return "Preview stopped";
  }
}

function shouldHideUnavailablePreview(data: IssueDevServersResponse): boolean {
  if (data.available || data.servers.length > 0) {
    return false;
  }

  return data.reason === "disabled" || data.reason === "no_serve_step" || data.reason === "workspace_missing";
}
