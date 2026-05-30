import { ExternalLink, GitBranch } from "lucide-react";

import { getStatusMeta } from "@/components/board/status-meta";
import { labelDotClass } from "@/components/board/label-colors";
import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { PriorityIndicator, priorityLabel } from "@/components/issues/PriorityIndicator";
import { PullRequestLink } from "@/components/issues/pull-request/PullRequestLink";
import { Markdown } from "@/components/ui/markdown";
import { Separator } from "@/components/ui/separator";
import { cn, formatDateTime } from "@/lib/utils";
import type { Comment } from "@/types/comment";
import type { Issue } from "@/types/issue";
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
  const hasLinks = Boolean(issue.url) || issue.branchName !== null || pullRequests.length > 0;

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
