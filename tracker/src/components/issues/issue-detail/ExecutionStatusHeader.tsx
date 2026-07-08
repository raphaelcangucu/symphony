import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { AgentLongRunningBadge, AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { AgentResumeIconButton } from "@/components/issues/AgentResumeIconButton";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { resolveDisplayStatus } from "@/lib/agentExecutionDisplay";
import { formatDateTime, formatDurationSeconds } from "@/lib/timeFormat";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface ExecutionStatusHeaderProps {
  projectSlug: string;
  issue: Issue;
  execution?: AgentExecution;
  onIssueUpdated?: (updated: Issue) => void;
}

function formatTokens(value: number): string {
  return value.toLocaleString();
}

/**
 * Compact chat header for the execution conversation: the live status row is
 * always visible, while detailed run metadata, token accounting and assignment
 * live behind a collapsible section so the transcript stays the focus of the
 * panel. Agent selection is handled by the composer's agent menu.
 */
export function ExecutionStatusHeader({
  projectSlug,
  issue,
  execution,
  onIssueUpdated,
}: ExecutionStatusHeaderProps) {
  const { t } = useTranslation();
  const displayStatus = execution ? resolveDisplayStatus(execution) : undefined;

  return (
    <section className="rounded-xl border border-border/70 bg-card/40 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.agent.tab.runStatus")}
          </span>
          {execution?.agentKind ? (
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              {agentKindLabel(execution.agentKind, t)}
            </span>
          ) : null}
        </div>
        {execution ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="inline-flex items-center gap-0.5">
              <AgentStatusBadge status={displayStatus!} />
              <AgentResumeIconButton
                projectSlug={projectSlug}
                issueIdentifier={issue.identifier}
                execution={execution}
                onIssueUpdated={onIssueUpdated}
              />
            </span>
            <AgentLongRunningBadge execution={execution} />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{t("issue.agent.tab.noActiveAgent")}</span>
        )}
      </div>

      {execution?.lastEvent || execution?.lastMessage ? (
        <div className="mt-2 space-y-1.5">
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

      {execution?.error ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-destructive">{execution.error}</p>
      ) : null}

      {execution ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {t("issue.agent.tab.details")}
          </summary>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
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
            <div className="mt-4">
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

          <div className="mt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("issue.agent.tab.assignment")}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <AssigneeAvatar login={issue.assignee} />
              <span>{issue.assignee || t("issue.agent.tab.noAgentAssigned")}</span>
            </div>
          </div>
        </details>
      ) : (
        <p className="mt-3 text-muted-foreground">{t("issue.agent.tab.noExecution")}</p>
      )}
    </section>
  );
}
