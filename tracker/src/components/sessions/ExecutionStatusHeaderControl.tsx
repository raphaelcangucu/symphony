import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AgentLongRunningBadge, AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { AgentResumeIconButton } from "@/components/issues/AgentResumeIconButton";
import { ExecutionStatusDetails } from "@/components/issues/issue-detail/ExecutionStatusDetails";
import { useSessionExecutionStatus } from "@/components/sessions/sessionExecutionStatusContext";
import { sessionToolbarChipClassName } from "@/components/sessions/sessionToolbarStyles";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import { cn } from "@/lib/utils";

/**
 * Compact live-status chip for the session header bar. Renders nothing for
 * interactive threads (no execution published); for execution threads it shows
 * the run status and reveals the full run details in a popover on click.
 */
export function ExecutionStatusHeaderControl() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const status = useSessionExecutionStatus();

  if (!status?.execution) return null;

  const { projectSlug, issue, execution, onIssueUpdated } = status;
  const displayStatus = resolveDisplayStatus(execution);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="execution-status-header-control"
          aria-label={t("issue.agent.tab.runStatus")}
          title={t("issue.agent.tab.runStatus")}
          className={cn(
            sessionToolbarChipClassName,
            "gap-1 border-transparent bg-transparent px-1 py-0 hover:bg-muted/60",
          )}
        >
          <AgentStatusBadge status={displayStatus} />
          <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("issue.agent.tab.runStatus")}
            </span>
            {execution.agentKind ? (
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                {agentKindLabel(execution.agentKind, t)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="inline-flex items-center gap-0.5">
              <AgentStatusBadge status={displayStatus} />
              <AgentResumeIconButton
                projectSlug={projectSlug}
                issueIdentifier={issue.identifier}
                execution={execution}
                onIssueUpdated={onIssueUpdated}
              />
            </span>
            <AgentLongRunningBadge execution={execution} />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          <ExecutionStatusDetails issue={issue} execution={execution} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
