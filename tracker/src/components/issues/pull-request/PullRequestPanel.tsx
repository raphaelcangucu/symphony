import { useState } from "react";
import { ArrowDownToLine, ArrowRight, ExternalLink, GitBranch, GitMerge, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { CommentCard, ReviewBadge } from "@/components/issues/issue-detail/CommentCard";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn, formatDateTime } from "@/lib/utils";
import { mergePullRequest, updatePullRequestBranch } from "@/services/pullRequests";
import type { PullRequest, PullRequestMergeMethod, PullRequestPipeline } from "@/types/pull-request";

import { MERGE_CONFLICT_META, hasMergeConflicts, jobMeta, prStateMeta, rollupMeta, statusStateMeta } from "./pr-meta";

interface PullRequestPanelProps {
  pullRequest: PullRequest;
  projectSlug: string;
  issueIdentifier: string;
  onRefresh: () => void;
  onRemove?: () => void;
}

export function PullRequestPanel({
  pullRequest: pr,
  projectSlug,
  issueIdentifier,
  onRefresh,
  onRemove,
}: PullRequestPanelProps) {
  const [updating, setUpdating] = useState(false);
  const [merging, setMerging] = useState<"normal" | "force" | null>(null);
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>("merge");
  const behind = pr.baseBehindBy ?? 0;
  const canUpdate = behind > 0;
  const canMerge = pr.state === "open";

  async function handleUpdateBranch() {
    if (updating) return;
    setUpdating(true);
    try {
      await updatePullRequestBranch(projectSlug, issueIdentifier, pr.number);
      toast.success("Branch update started — following CI…");
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update the branch.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleMerge(bypass: boolean) {
    const mode = bypass ? "force" : "normal";
    if (merging) return;
    setMerging(mode);
    try {
      await mergePullRequest(projectSlug, issueIdentifier, pr.number, { method: mergeMethod, bypass });
      toast.success(bypass ? "Force merge completed — issue moved to Done." : "Pull request merged — issue moved to Done.");
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not merge the pull request.");
    } finally {
      setMerging(null);
    }
  }

  const state = prStateMeta(pr.state);
  const StateIcon = state.Icon;
  const rollup = rollupMeta(pr.checksState);
  const RollupIcon = rollup.Icon;
  const hasChecks = pr.pipelines.length > 0 || pr.statuses.length > 0;
  const conflicting = hasMergeConflicts(pr);
  const ConflictIcon = MERGE_CONFLICT_META.Icon;

  return (
    <article className="rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-0.5 text-xs font-semibold",
                state.className,
              )}
            >
              <StateIcon className="h-3.5 w-3.5" />
              {state.label}
            </span>
            <span className="font-mono text-xs text-muted-foreground">#{pr.number}</span>
            {pr.repo ? (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {pr.repo}
              </span>
            ) : null}
            {pr.origin === "manual" ? (
              <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                linked
              </span>
            ) : null}
            {pr.origin === "auto" ? (
              <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                agent
              </span>
            ) : null}
            {conflicting ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold",
                  MERGE_CONFLICT_META.className,
                )}
                title="This branch has conflicts that must be resolved before it can merge."
              >
                <ConflictIcon className="h-3 w-3" />
                {MERGE_CONFLICT_META.label}
              </span>
            ) : null}
          </div>
          <h3 className="text-sm font-semibold leading-snug">{pr.title ?? `Pull request #${pr.number}`}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {pr.author ? (
              <span className="inline-flex items-center gap-1.5">
                <AssigneeAvatar login={pr.author} />
                {pr.author}
              </span>
            ) : null}
            {pr.headRef ? (
              <span className="inline-flex items-center gap-1 font-mono">
                <GitBranch className="h-3 w-3" />
                {pr.baseRef ? (
                  <>
                    {pr.baseRef}
                    <ArrowRight className="h-3 w-3" />
                  </>
                ) : null}
                {pr.headRef}
              </span>
            ) : null}
            {pr.updatedAt ? <span>Updated {formatDateTime(pr.updatedAt)}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canMerge ? (
            <>
              <label className="sr-only" htmlFor={`merge-method-${pr.number}`}>
                Merge method
              </label>
              <select
                id={`merge-method-${pr.number}`}
                value={mergeMethod}
                onChange={(event) => setMergeMethod(event.target.value as PullRequestMergeMethod)}
                disabled={merging !== null}
                className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium disabled:opacity-50"
              >
                <option value="merge">Merge commit</option>
                <option value="squash">Squash</option>
                <option value="rebase">Rebase</option>
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleMerge(false)}
                disabled={merging !== null}
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-300"
              >
                <GitMerge className={cn("h-4 w-4", merging === "normal" && "animate-pulse")} />
                {merging === "normal" ? "Merging…" : "Merge"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleMerge(true)}
                disabled={merging !== null}
                className="border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/20 hover:text-red-700 dark:text-red-300 dark:hover:text-red-300"
                title="Attempts an immediate merge with the configured GitHub token. GitHub still enforces token permissions and branch rules."
              >
                <ShieldCheck className={cn("h-4 w-4", merging === "force" && "animate-pulse")} />
                {merging === "force" ? "Force merging…" : "Force merge"}
              </Button>
            </>
          ) : null}
          {canUpdate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleUpdateBranch()}
              disabled={updating}
              className="border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-300"
            >
              <ArrowDownToLine className={cn("h-4 w-4", updating && "animate-pulse")} />
              {updating ? "Updating…" : `Update branch (${behind} behind)`}
            </Button>
          ) : null}
          {pr.url ? (
            <Button asChild variant="outline" size="sm">
              <a href={pr.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            </Button>
          ) : null}
          {onRemove ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRemove}
              title="Unlink this pull request"
              aria-label="Unlink this pull request"
              className="w-8 px-0 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="space-y-4 p-4">
        <div className={cn("inline-flex items-center gap-1.5 text-xs font-medium", rollup.className)}>
          <RollupIcon className={cn("h-3.5 w-3.5", rollup.spin && "animate-spin")} />
          {rollup.label}
        </div>

        {hasChecks ? (
          <div className="space-y-3">
            {pr.pipelines.map((pipeline) => (
              <PipelineGroup key={pipeline.name} pipeline={pipeline} />
            ))}
            {pr.statuses.length > 0 ? (
              <div className="rounded-lg border">
                <div className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">Status checks</div>
                <ul className="divide-y">
                  {pr.statuses.map((status, index) => {
                    const meta = statusStateMeta(status.state);
                    const Icon = meta.Icon;
                    return (
                      <li
                        key={status.context ?? `status-${index}`}
                        className="flex items-center gap-2 px-3 py-2 text-xs"
                      >
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.className, meta.spin && "animate-spin")} />
                        <span className="font-medium">{status.context ?? "status"}</span>
                        {status.description ? (
                          <span className="truncate text-muted-foreground">{status.description}</span>
                        ) : null}
                        {status.url ? (
                          <a
                            href={status.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="ml-auto text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No CI checks reported for this pull request.</p>
        )}

        {pr.conversation.length > 0 ? (
          <>
            <Separator />
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Conversation
              </h4>
              {pr.conversation.map((entry, index) => (
                <CommentCard
                  key={`${entry.author ?? "anon"}-${index}`}
                  author={entry.author}
                  body={entry.body}
                  createdAt={entry.createdAt}
                  badge={
                    entry.kind === "review" && entry.reviewState ? (
                      <ReviewBadge state={entry.reviewState} />
                    ) : undefined
                  }
                />
              ))}
            </section>
          </>
        ) : null}
      </div>
    </article>
  );
}

function PipelineGroup({ pipeline }: { pipeline: PullRequestPipeline }) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold">{pipeline.name}</span>
        {pipeline.url ? (
          <a
            href={pipeline.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <ul className="divide-y">
        {pipeline.jobs.map((job, index) => {
          const meta = jobMeta(job);
          const Icon = meta.Icon;
          return (
            <li key={`${job.name ?? "job"}-${index}`} className="flex items-center gap-2 px-3 py-2 text-xs">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.className, meta.spin && "animate-spin")} />
              <span className="truncate font-medium">{job.name ?? "job"}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{meta.label}</span>
              {job.url ? (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
