import { ArrowRight, ExternalLink, GitBranch } from "lucide-react";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { Markdown } from "@/components/ui/markdown";
import { Separator } from "@/components/ui/separator";
import { cn, formatDateTime } from "@/lib/utils";
import type { PullRequest, PullRequestPipeline } from "@/types/pull-request";

import { jobMeta, prStateMeta, rollupMeta, statusStateMeta } from "./pr-meta";

interface PullRequestPanelProps {
  pullRequest: PullRequest;
}

export function PullRequestPanel({ pullRequest: pr }: PullRequestPanelProps) {
  const state = prStateMeta(pr.state);
  const StateIcon = state.Icon;
  const rollup = rollupMeta(pr.checksState);
  const RollupIcon = rollup.Icon;
  const hasChecks = pr.pipelines.length > 0 || pr.statuses.length > 0;

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
        {pr.url ? (
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </a>
        ) : null}
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
                <div key={`${entry.author ?? "anon"}-${index}`} className="rounded-lg border p-3">
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <AssigneeAvatar login={entry.author} />
                    <span className="font-medium text-foreground">{entry.author ?? "unknown"}</span>
                    {entry.kind === "review" && entry.reviewState ? (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">
                        {entry.reviewState.replaceAll("_", " ").toLowerCase()}
                      </span>
                    ) : null}
                    {entry.createdAt ? <span className="ml-auto">{formatDateTime(entry.createdAt)}</span> : null}
                  </div>
                  <Markdown>{entry.body}</Markdown>
                </div>
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
