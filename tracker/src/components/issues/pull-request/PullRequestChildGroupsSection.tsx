import { useTranslation } from "react-i18next";

import { PullRequestIssueCards } from "@/components/issues/pull-request/PullRequestIssueCards";
import type { PullRequestGroup } from "@/types/pull-request";

export interface PullRequestChildGroupsSectionProps {
  groups: PullRequestGroup[];
  projectSlug: string;
  onRefresh: () => void;
  supported: boolean;
  available: boolean;
}

/**
 * Lab-only grouped view: sub-issue PRs consolidated under a parent issue.
 * Each group reuses PullRequestIssueCards for identical controls (checks, remove, merge).
 */
export function PullRequestChildGroupsSection({
  groups,
  projectSlug,
  onRefresh,
  supported,
  available,
}: PullRequestChildGroupsSectionProps) {
  const { t } = useTranslation();
  const visibleGroups = groups.filter((group) => group.pullRequests.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div>
        <p className="text-xs font-medium text-foreground">{t("issue.pullRequest.childrenTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("issue.pullRequest.childrenSubtitle")}</p>
      </div>
      {visibleGroups.map((group) => (
        <div key={group.identifier} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {group.identifier}
              {group.title ? <span className="font-sans"> — {group.title}</span> : null}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("issue.pullRequest.childGroupCount", { count: group.pullRequests.length })}
            </span>
          </div>
          <PullRequestIssueCards
            pullRequests={group.pullRequests}
            projectSlug={projectSlug}
            issueIdentifier={group.identifier}
            onRefresh={onRefresh}
            supported={supported}
            available={available}
          />
        </div>
      ))}
    </div>
  );
}
