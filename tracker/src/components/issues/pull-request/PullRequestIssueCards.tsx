import { useState } from "react";
import { RotateCcw, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { hasFailingChecks } from "@/components/issues/pull-request/pr-meta";
import { PullRequestPanel } from "@/components/issues/pull-request/PullRequestPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requestPullRequestFix, rerunFailedJobs, unlinkPullRequest } from "@/services/pullRequests";
import type { PullRequest, RerunResult } from "@/types/pull-request";

export interface PullRequestIssueCardsProps {
  pullRequests: PullRequest[];
  projectSlug: string;
  issueIdentifier: string;
  onRefresh: () => void;
  supported: boolean;
  available: boolean;
  showCheckActions?: boolean;
}

/**
 * Reusable PR list for any issue (parent or child): check toolbar, full CI panel,
 * merge/update actions, and unlink — same behavior everywhere.
 */
export function PullRequestIssueCards({
  pullRequests,
  projectSlug,
  issueIdentifier,
  onRefresh,
  supported,
  available,
  showCheckActions = true,
}: PullRequestIssueCardsProps) {
  const { t } = useTranslation();
  const [fixing, setFixing] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  if (pullRequests.length === 0) return null;

  const canUseLiveActions = supported && available;
  const canFix = pullRequests.some(hasFailingChecks);
  const canRerun = pullRequests.some(hasFailingChecks);

  async function handleFix() {
    if (fixing) return;
    setFixing(true);
    try {
      const result = await requestPullRequestFix(projectSlug, issueIdentifier);
      toast.success(t("issue.pullRequest.toasts.fixSent", { status: result.movedTo }));
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.pullRequest.toasts.fixFailed"));
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
        results.push(...(await rerunFailedJobs(projectSlug, issueIdentifier, pr.number)));
      }
      if (results.some((result) => result.ok === false)) {
        toast.error(t("issue.pullRequest.toasts.rerunPartialFailed"));
      } else {
        toast.success(t("issue.pullRequest.toasts.rerunSuccess"));
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.pullRequest.toasts.rerunFailed"));
    } finally {
      setRerunning(false);
      onRefresh();
    }
  }

  async function handleRemove(url: string | null) {
    if (!url) return;
    try {
      await unlinkPullRequest(projectSlug, issueIdentifier, url);
      toast.success(t("issue.pullRequest.toasts.unlinked"));
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.pullRequest.toasts.unlinkFailed"));
    }
  }

  return (
    <div className="space-y-3">
      {showCheckActions && canUseLiveActions && (canFix || canRerun) ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canRerun ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRerun()}
              disabled={rerunning}
              className="text-muted-foreground"
            >
              <RotateCcw aria-hidden="true" className={cn("h-4 w-4", rerunning && "animate-spin")} />
              {rerunning ? t("issue.pullRequest.rerunning") : t("issue.pullRequest.rerunFailedJobs")}
            </Button>
          ) : null}
          {canFix ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleFix()}
              disabled={fixing}
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-300"
            >
              <Wrench className={cn("h-4 w-4", fixing && "animate-pulse")} />
              {fixing ? t("issue.pullRequest.sending") : t("issue.pullRequest.fixWithAgent")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {pullRequests.map((pr) => (
        <PullRequestPanel
          key={pr.url ?? `${pr.repo}#${pr.number}`}
          pullRequest={pr}
          projectSlug={projectSlug}
          issueIdentifier={issueIdentifier}
          onRefresh={onRefresh}
          onRemove={
            pr.origin === "manual" || pr.origin === "auto"
              ? () => void handleRemove(pr.url)
              : undefined
          }
        />
      ))}
    </div>
  );
}
