import { useState } from "react";
import { GitPullRequest, RefreshCw } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { PullRequestChildGroupsSection } from "@/components/issues/pull-request/PullRequestChildGroupsSection";
import { PullRequestIssueCards } from "@/components/issues/pull-request/PullRequestIssueCards";
import { Button } from "@/components/ui/button";
import { EmptyState as SharedEmptyState } from "@/components/ui/empty-state";
import { linkPullRequest } from "@/services/pullRequests";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/issue";
import type { PullRequest, PullRequestGroup, PullRequestMonitorInfo } from "@/types/pull-request";

interface PullRequestTabProps {
  issue: Issue;
  projectSlug: string;
  pullRequests: PullRequest[];
  pullRequestChildren?: PullRequestGroup[];
  labBundleChildOrchestration?: boolean;
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
  pullRequestChildren = [],
  labBundleChildOrchestration = false,
  supported,
  available,
  loading,
  error,
  onRefresh,
}: PullRequestTabProps) {
  const { t } = useTranslation();
  const [linkUrl, setLinkUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const monitorEntries = pullRequests
    .filter((pr) => pr.monitor?.lastAction)
    .map((pr) => ({ pr, monitor: pr.monitor! }));

  const childrenSection =
    labBundleChildOrchestration ? (
      <PullRequestChildGroupsSection
        groups={pullRequestChildren}
        projectSlug={projectSlug}
        onRefresh={onRefresh}
        supported={supported}
        available={available}
      />
    ) : null;

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

  const ownCards = (
    <PullRequestIssueCards
      pullRequests={pullRequests}
      projectSlug={projectSlug}
      issueIdentifier={issue.identifier}
      onRefresh={onRefresh}
      supported={supported}
      available={available}
    />
  );

  const childGroupCount = pullRequestChildren.filter((group) => group.pullRequests.length > 0).length;

  if (loading && pullRequests.length === 0 && childGroupCount === 0) {
    return <EmptyState>{t("issue.pullRequest.loading")}</EmptyState>;
  }

  if (error && pullRequests.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState>
          {error}{" "}
          <button type="button" onClick={onRefresh} className="underline">
            {t("issue.pullRequest.retry")}
          </button>
        </EmptyState>
        {childrenSection}
      </div>
    );
  }

  if (pullRequests.length === 0) {
    if (!supported) {
      return (
        <div className="space-y-4">
          <EmptyState>{t("issue.pullRequest.unsupported", { identifier: issue.identifier })}</EmptyState>
          {childrenSection}
        </div>
      );
    }

    if (!available) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-end">{refreshButton}</div>
          <EmptyState>{t("issue.pullRequest.tokenRequired")}</EmptyState>
          {linkRow}
          {childrenSection}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">{refreshButton}</div>
        <EmptyState>{t("issue.pullRequest.empty", { identifier: issue.identifier })}</EmptyState>
        {linkRow}
        {childrenSection}
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
        {refreshButton}
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
      {ownCards}
      {childrenSection}
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
    <SharedEmptyState variant="simple" icon={<GitPullRequest className="h-5 w-5" />}>
      <p>{children}</p>
    </SharedEmptyState>
  );
}
