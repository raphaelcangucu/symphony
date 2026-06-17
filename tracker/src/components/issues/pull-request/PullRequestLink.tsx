import { ArrowRight, ExternalLink, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { PullRequest } from "@/types/pull-request";

import { jobOutcomeCategory, prStateMeta, rollupMeta } from "./pr-meta";

interface PullRequestLinkProps {
  pullRequest: PullRequest;
  onOpen?: () => void;
}

export function PullRequestLink({ pullRequest: pr, onOpen }: PullRequestLinkProps) {
  const { t } = useTranslation();
  const state = prStateMeta(pr.state, t);
  const StateIcon = state.Icon;
  const rollup = rollupMeta(pr.checksState, t);
  const RollupIcon = rollup.Icon;

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent"
        >
          <StateIcon className={cn("h-3.5 w-3.5", state.className)} />
          <span className="font-mono">#{pr.number}</span>
          <RollupIcon className={cn("h-3 w-3", rollup.className, rollup.spin && "animate-spin")} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent>
        <PullRequestPreview pullRequest={pr} />
      </HoverCardContent>
    </HoverCard>
  );
}

function PullRequestPreview({ pullRequest: pr }: { pullRequest: PullRequest }) {
  const { t } = useTranslation();
  const state = prStateMeta(pr.state, t);
  const StateIcon = state.Icon;
  const rollup = rollupMeta(pr.checksState, t);
  const RollupIcon = rollup.Icon;

  const jobs = pr.pipelines.flatMap((pipeline) => pipeline.jobs);
  const counts = jobs.reduce(
    (acc, job) => {
      const category = jobOutcomeCategory(job);
      acc[category] += 1;
      return acc;
    },
    { passed: 0, failed: 0, running: 0, other: 0 },
  );

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", state.className)}>
          <StateIcon className="h-3.5 w-3.5" />
          {state.label}
        </span>
        <span className="font-mono text-xs text-muted-foreground">#{pr.number}</span>
        {pr.url ? (
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <p className="text-sm font-medium leading-snug">
        {pr.title ?? t("issue.pullRequest.link.titleFallback", { number: pr.number })}
      </p>
      {pr.headRef ? (
        <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <GitBranch className="h-3 w-3" />
          {pr.baseRef ? (
            <>
              {pr.baseRef}
              <ArrowRight className="h-3 w-3" />
            </>
          ) : null}
          {pr.headRef}
        </p>
      ) : null}
      <div className={cn("flex items-center gap-1.5 text-xs font-medium", rollup.className)}>
        <RollupIcon className={cn("h-3.5 w-3.5", rollup.spin && "animate-spin")} />
        {rollup.label}
      </div>
      {jobs.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {counts.passed > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              {t("issue.pullRequest.link.counts.passed", { count: counts.passed })}
            </span>
          ) : null}
          {counts.failed > 0 ? (
            <span className="text-rose-600 dark:text-rose-400">
              {t("issue.pullRequest.link.counts.failed", { count: counts.failed })}
            </span>
          ) : null}
          {counts.running > 0 ? (
            <span className="text-amber-600 dark:text-amber-400">
              {t("issue.pullRequest.link.counts.running", { count: counts.running })}
            </span>
          ) : null}
          {counts.other > 0 ? (
            <span>{t("issue.pullRequest.link.counts.other", { count: counts.other })}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
