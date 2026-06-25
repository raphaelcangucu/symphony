import { useState } from "react";
import { GitPullRequest, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [fixing, setFixing] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const canFix = pullRequests.some(hasFailingChecks);
  const monitorEntries = pullRequests
    .filter((pr) => pr.monitor?.lastAction)
    .map((pr) => ({ pr, monitor: pr.monitor! }));

  const canUseLiveActions = supported && available;

  async function handleFix() {
    if (fixing) return;
    setFixing(true);
    try {
      const result = await requestPullRequestFix(projectSlug, issue.identifier);
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
        results.push(...(await rerunFailedJobs(projectSlug, issue.identifier, pr.number)));
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

  async function handleLink() {
    if (linking || !linkUrl.trim()) return;
    setLinking(true);
    try {
      await linkPullRequest(projectSlug, issue.identifier, linkUrl);
      setLinkUrl("");
      toast.success(t("issue.pullRequest.toasts.linked"));
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.pullRequest.toasts.linkFailed"));
    } finally {
      setLinking(false);
    }
  }

  async function handleRemove(url: string | null) {
    if (!url) return;
    try {
      await unlinkPullRequest(projectSlug, issue.identifier, url);
      toast.success(t("issue.pullRequest.toasts.unlinked"));
      onRefresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.pullRequest.toasts.unlinkFailed"));
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
      {t("issue.pullRequest.refresh")}
    </Button>
  );

  const linkRow = (
    <div className="flex items-center gap-2">
      <input
        type="url"
        value={linkUrl}
        onChange={(event) => setLinkUrl(event.target.value)}
        placeholder={t("issue.pullRequest.linkPlaceholder")}
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
        {linking ? t("issue.pullRequest.linking") : t("issue.pullRequest.linkPr")}
      </Button>
    </div>
  );

  if (loading && pullRequests.length === 0) {
    return <EmptyState>{t("issue.pullRequest.loading")}</EmptyState>;
  }

  if (error && pullRequests.length === 0) {
    return (
      <EmptyState>
        {error}{" "}
        <button type="button" onClick={onRefresh} className="underline">
          {t("issue.pullRequest.retry")}
        </button>
      </EmptyState>
    );
  }

  if (pullRequests.length === 0) {
    if (!supported) {
      return (
        <EmptyState>{t("issue.pullRequest.unsupported", { identifier: issue.identifier })}</EmptyState>
      );
    }

    if (!available) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-end">{refreshButton}</div>
          <EmptyState>{t("issue.pullRequest.tokenRequired")}</EmptyState>
          {linkRow}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">{refreshButton}</div>
        <EmptyState>{t("issue.pullRequest.empty", { identifier: issue.identifier })}</EmptyState>
        {linkRow}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!available ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("issue.pullRequest.limitedAccessTitle")}</span>{" "}
          {t("issue.pullRequest.limitedAccessBody")}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("issue.pullRequest.relatedCount", { count: pullRequests.length })}
        </span>
        <div className="flex items-center gap-2">
          {canUseLiveActions && canFix ? (
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
                {rerunning ? t("issue.pullRequest.rerunning") : t("issue.pullRequest.rerunFailedJobs")}
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
                {fixing ? t("issue.pullRequest.sending") : t("issue.pullRequest.fixWithAgent")}
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
          <span className="font-medium text-foreground">{monitorLabel(monitor, t)}</span>
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

function monitorLabel(monitor: PullRequestMonitorInfo, t: TFunction): string {
  switch (monitor.lastAction) {
    case "moved_to_rework":
      return t("issue.pullRequest.monitor.movedToRework", { count: Math.max(1, monitor.autoReworkCount) });
    case "moved_to_done":
      return t("issue.pullRequest.monitor.movedToDone");
    case "kept_human_review":
      return t("issue.pullRequest.monitor.keptHumanReview");
    case "limit_reached":
      return t("issue.pullRequest.monitor.limitReached");
    default:
      return t("issue.pullRequest.monitor.fallback", { action: monitor.lastAction ?? "status" });
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
