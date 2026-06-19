import { Crown, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getStatusMeta } from "@/components/board/status-meta";
import { cn } from "@/lib/utils";

import type { ResolvedIssueGroup } from "./issueGroup";

interface IssueGroupBannerProps {
  group: ResolvedIssueGroup;
  currentIdentifier: string;
  onOpenIssue?: (identifier: string) => void;
}

/**
 * Compact panel in the issue detail header listing every issue in the same
 * group (lead first), so a grouped task surfaces its siblings. The current
 * issue is highlighted; the others link to their own detail view.
 */
export function IssueGroupBanner({ group, currentIdentifier, onOpenIssue }: IssueGroupBannerProps) {
  const { t } = useTranslation();
  const memberCount = group.members.length - 1;

  return (
    <div className="mb-4 rounded-lg border border-border/60 bg-muted/20 p-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        {t("issue.drawer.group.title")}
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold normal-case text-muted-foreground">
          {t("board.group.count", { count: memberCount })}
        </span>
      </div>
      <ul className="space-y-0.5">
        {group.members.map((member) => {
          const isCurrent = member.identifier === currentIdentifier;
          const status = member.issue?.status;
          const StatusIcon = status ? getStatusMeta(status).Icon : null;
          const statusClass = status ? getStatusMeta(status).iconClass : "";

          return (
            <li key={member.identifier}>
              <button
                type="button"
                disabled={isCurrent}
                onClick={() => {
                  if (!isCurrent) onOpenIssue?.(member.identifier);
                }}
                title={member.issue?.title ?? member.identifier}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                  isCurrent
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {StatusIcon ? <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusClass)} /> : null}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{member.identifier}</span>
                <span className="min-w-0 flex-1 truncate">
                  {member.issue?.title ?? t("issue.drawer.group.unavailable")}
                </span>
                {member.isLead ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    <Crown className="h-3 w-3" />
                    {t("issue.drawer.group.lead")}
                  </span>
                ) : null}
                {isCurrent ? (
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary">
                    {t("issue.drawer.group.current")}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
