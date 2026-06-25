import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { AgentLongRunningBadge, AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { ExecutionControlComposer } from "@/components/issues/issue-detail/ExecutionControlComposer";
import { ReturnToAgentPanel } from "@/components/issues/issue-detail/ReturnToAgentPanel";
import { IssueSessionLog } from "@/components/issues/issue-detail/IssueSessionLog";
import { AGENT_ICONS, AGENT_KINDS, agentKindLabel, AgentChip } from "@/components/shared/AgentChip";
import { Separator } from "@/components/ui/separator";
import { useSessionLogChannel } from "@/hooks/useSessionLogChannel";
import { formatDateTime } from "@/lib/utils";
import {
  canResumeExecution,
  canSteerExecution,
  resolveDisplayStatus,
} from "@/lib/agentExecutionDisplay";
import { assessEvidenceAttention, type EvidenceAttention } from "@/lib/evidenceStatus";
import type { ReturnToAgentTemplate } from "@/lib/returnToAgent";
import { isWaitState, parseWorkflowTrackerConfig, type WorkflowTrackerConfig } from "@/lib/workflowTracker";
import { updateIssueAgent } from "@/services/issues";
import type { AgentExecution } from "@/types/agent-execution";
import type { AgentKind, Issue } from "@/types/issue";

interface AgentTabProps {
  issue: Issue;
  execution?: AgentExecution;
  projectSlug: string;
  workflowMarkdown?: string | null;
  evidenceAttention?: EvidenceAttention;
  returnToAgentTemplate?: ReturnToAgentTemplate | null;
  steerSeedMessage?: string | null;
  onIssueUpdated?: (updated: Issue) => void;
}

function formatRuntime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "-";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTokens(value: number): string {
  return value.toLocaleString();
}

export function AgentTab({
  issue,
  execution,
  projectSlug,
  workflowMarkdown = null,
  evidenceAttention,
  returnToAgentTemplate = null,
  steerSeedMessage = null,
  onIssueUpdated,
}: AgentTabProps) {
  const { t } = useTranslation();
  const [agentPending, setAgentPending] = useState(false);
  const trackerConfig: WorkflowTrackerConfig = parseWorkflowTrackerConfig(workflowMarkdown);
  const inWaitState = isWaitState(issue.status, trackerConfig);
  const showReturnPanel = inWaitState && canResumeExecution(execution);
  const resolvedEvidenceAttention = evidenceAttention ?? assessEvidenceAttention([]);
  const displayStatus = execution ? resolveDisplayStatus(execution) : undefined;
  const agentRunActive = execution ? !canResumeExecution(execution) : false;
  const sessionLog = useSessionLogChannel({
    projectSlug,
    issueIdentifier: issue.identifier,
    enabled: true,
    agentKind: execution?.agentKind ?? issue.agentKind ?? null,
  });
  const canSteer = canSteerExecution(execution);

  async function changeAgent(agent: AgentKind | null) {
    setAgentPending(true);
    try {
      const updated = await updateIssueAgent(projectSlug, issue.identifier, agent);
      onIssueUpdated?.(updated);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.agent.tab.updateFailed"));
    } finally {
      setAgentPending(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("issue.agent.tab.runStatus")}
            </div>
            {execution?.agentKind ? (
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                {agentKindLabel(execution.agentKind, t)}
              </span>
            ) : null}
          </div>
          {execution ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <AgentStatusBadge status={displayStatus!} />
              <AgentLongRunningBadge execution={execution} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t("issue.agent.tab.noActiveAgent")}</span>
          )}
        </div>

        {execution ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
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
              <dd className="mt-1">{formatRuntime(execution.runtimeSeconds)}</dd>
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
        ) : (
          <p className="mt-3 text-muted-foreground">{t("issue.agent.tab.noExecution")}</p>
        )}
      </section>

      {execution?.lastMessage || execution?.lastEvent ? (
        <section className="rounded-xl border border-border/70 bg-card/40 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.agent.tab.latestUpdate")}
          </div>
          {execution.lastEvent ? (
            <div className="mt-2 inline-flex items-center rounded-full border border-border/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {execution.lastEvent}
            </div>
          ) : null}
          {execution.lastMessage ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{execution.lastMessage}</p>
          ) : null}
        </section>
      ) : null}

      {execution?.error ? (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-destructive">
            {t("issue.agent.tab.lastError")}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-destructive">{execution.error}</p>
        </section>
      ) : null}

      {execution?.tokens ? (
        <section className="rounded-xl border border-border/70 bg-card/40 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.agent.tab.tokens")}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
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
        </section>
      ) : null}

      {showReturnPanel ? (
        <ReturnToAgentPanel
          projectSlug={projectSlug}
          issue={issue}
          trackerConfig={trackerConfig}
          evidenceAttention={resolvedEvidenceAttention}
          initialTemplate={returnToAgentTemplate}
          onIssueUpdated={onIssueUpdated}
        />
      ) : null}

      <IssueSessionLog
        issueIdentifier={issue.identifier}
        connected={sessionLog.connected}
        entries={sessionLog.entries}
        error={sessionLog.error}
        logAgentKind={sessionLog.logAgentKind}
        preferredAgentKind={sessionLog.preferredAgentKind ?? execution?.agentKind ?? issue.agentKind}
      />

      {showReturnPanel ? (
        <details className="rounded-xl border border-border/70 bg-card/20 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {t("issue.agent.advancedControls")}
          </summary>
          <div className="mt-3">
            <ExecutionControlComposer
              projectSlug={projectSlug}
              issue={issue}
              execution={execution}
              sessionConnected={sessionLog.connected}
              canSteer={canSteer}
              steerPending={sessionLog.steerPending}
              steerError={sessionLog.steerError}
              seedMessage={steerSeedMessage}
              onSteer={sessionLog.steerTurn}
              onIssueUpdated={onIssueUpdated}
            />
          </div>
        </details>
      ) : (
        <ExecutionControlComposer
          projectSlug={projectSlug}
          issue={issue}
          execution={execution}
          sessionConnected={sessionLog.connected}
          canSteer={canSteer}
          steerPending={sessionLog.steerPending}
          steerError={sessionLog.steerError}
          seedMessage={steerSeedMessage}
          onSteer={sessionLog.steerTurn}
          onIssueUpdated={onIssueUpdated}
        />
      )}

      <Separator />
      <section>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("issue.agent.tab.assignment")}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <AssigneeAvatar login={issue.assignee} />
          <span>{issue.assignee || t("issue.agent.tab.noAgentAssigned")}</span>
        </div>
      </section>

      <section>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("issue.agent.tab.agentSection")}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <AgentChip
            label={t("issue.agent.tab.inherit")}
            active={!issue.agentKind}
            disabled={agentRunActive || agentPending}
            onClick={() => void changeAgent(null)}
          />
          {AGENT_KINDS.map((kind) => {
            const Icon = AGENT_ICONS[kind];
            return (
              <AgentChip
                key={kind}
                label={agentKindLabel(kind, t)}
                icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
                active={issue.agentKind === kind}
                disabled={agentRunActive || agentPending}
                onClick={() => void changeAgent(kind)}
              />
            );
          })}
        </div>
        {agentRunActive ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("issue.agent.tab.stopToChange")}</p>
        ) : execution?.status === "retrying" ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("issue.agent.tab.retryPaused")}</p>
        ) : null}
      </section>
    </div>
  );
}
