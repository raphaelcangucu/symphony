import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { formatDateTime, formatDurationSeconds } from "@/lib/timeFormat";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface ExecutionStatusDetailsProps {
  issue: Issue;
  execution: AgentExecution;
}

function formatTokens(value: number): string {
  return value.toLocaleString();
}

/**
 * Detailed run metadata for the current execution: latest event/message, error,
 * session/turn/runtime facts, token accounting and assignment. Shared by the
 * header status popover so the status chrome stays in one place.
 */
export function ExecutionStatusDetails({ issue, execution }: ExecutionStatusDetailsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3 text-sm">
      {execution.lastEvent || execution.lastMessage ? (
        <div className="space-y-1.5">
          {execution.lastEvent ? (
            <div className="inline-flex items-center rounded-full border border-border/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {execution.lastEvent}
            </div>
          ) : null}
          {execution.lastMessage ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
              {execution.lastMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {execution.error ? (
        <p className="whitespace-pre-wrap text-sm leading-6 text-destructive">{execution.error}</p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">{t("issue.agent.tab.session")}</dt>
          <dd className="mt-1 break-all font-mono text-xs text-foreground">{execution.sessionId ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("issue.agent.tab.turn")}</dt>
          <dd className="mt-1">{execution.turnCount > 0 ? `#${execution.turnCount}` : "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("issue.agent.tab.runtime")}</dt>
          <dd className="mt-1">{formatDurationSeconds(execution.runtimeSeconds)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("issue.agent.tab.started")}</dt>
          <dd className="mt-1">{execution.startedAt ? formatDateTime(execution.startedAt) : "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("issue.agent.tab.lastActivity")}</dt>
          <dd className="mt-1">{execution.lastEventAt ? formatDateTime(execution.lastEventAt) : "-"}</dd>
        </div>
        {execution.retryAttempt > 0 ? (
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">{t("issue.agent.tab.retryAttempt")}</dt>
            <dd className="mt-1">#{execution.retryAttempt}</dd>
          </div>
        ) : null}
      </dl>

      {execution.tokens ? (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.agent.tab.tokens")}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted/50 p-2">
              <dt className="text-[10px] uppercase text-muted-foreground">{t("issue.agent.tab.input")}</dt>
              <dd className="mt-0.5 font-semibold">{formatTokens(execution.tokens.input)}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <dt className="text-[10px] uppercase text-muted-foreground">{t("issue.agent.tab.output")}</dt>
              <dd className="mt-0.5 font-semibold">{formatTokens(execution.tokens.output)}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <dt className="text-[10px] uppercase text-muted-foreground">{t("issue.agent.tab.total")}</dt>
              <dd className="mt-0.5 font-semibold">{formatTokens(execution.tokens.total)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("issue.agent.tab.assignment")}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <AssigneeAvatar login={issue.assignee} />
          <span>{issue.assignee || t("issue.agent.tab.noAgentAssigned")}</span>
        </div>
      </div>
    </div>
  );
}
