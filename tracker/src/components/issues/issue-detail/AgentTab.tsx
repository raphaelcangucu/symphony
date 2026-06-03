import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { AgentStatusBadge } from "@/components/issues/AgentStatusBadge";
import { ExecutionSteerComposer } from "@/components/issues/issue-detail/ExecutionSteerComposer";
import { IssueSessionLog } from "@/components/issues/issue-detail/IssueSessionLog";
import { Separator } from "@/components/ui/separator";
import { useSessionLogChannel } from "@/hooks/useSessionLogChannel";
import { formatDateTime } from "@/lib/utils";
import type { AgentExecution } from "@/types/agent-execution";
import type { Issue } from "@/types/issue";

interface AgentTabProps {
  issue: Issue;
  execution?: AgentExecution;
  projectSlug: string;
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

export function AgentTab({ issue, execution, projectSlug }: AgentTabProps) {
  const sessionLogEnabled =
    execution?.status === "live" || execution?.status === "idle" || execution?.status === "waiting";
  const sessionLog = useSessionLogChannel({
    projectSlug,
    issueIdentifier: issue.identifier,
    enabled: sessionLogEnabled,
  });
  const canSteer = execution?.status === "live" || execution?.status === "waiting";

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Execution</div>
          {execution ? (
            <AgentStatusBadge status={execution.status} />
          ) : (
            <span className="text-xs text-muted-foreground">No active agent</span>
          )}
        </div>

        {execution ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Session</dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground">{execution.sessionId ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Turn</dt>
              <dd className="mt-1">{execution.turnCount > 0 ? `#${execution.turnCount}` : "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Runtime</dt>
              <dd className="mt-1">{formatRuntime(execution.runtimeSeconds)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Started</dt>
              <dd className="mt-1">{execution.startedAt ? formatDateTime(execution.startedAt) : "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last activity</dt>
              <dd className="mt-1">{execution.lastEventAt ? formatDateTime(execution.lastEventAt) : "-"}</dd>
            </div>
            {execution.retryAttempt > 0 ? (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Retry attempt</dt>
                <dd className="mt-1">#{execution.retryAttempt}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-3 text-muted-foreground">No agent is currently executing this issue.</p>
        )}
      </section>

      {execution?.lastMessage || execution?.lastEvent ? (
        <section className="rounded-xl border border-border/70 bg-card/40 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Latest update</div>
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
          <div className="text-[11px] font-semibold uppercase tracking-wider text-destructive">Last error</div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-destructive">{execution.error}</p>
        </section>
      ) : null}

      {execution?.tokens ? (
        <section className="rounded-xl border border-border/70 bg-card/40 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tokens</div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted/50 p-2">
              <dt className="text-[10px] uppercase text-muted-foreground">Input</dt>
              <dd className="mt-0.5 font-semibold">{formatTokens(execution.tokens.input)}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <dt className="text-[10px] uppercase text-muted-foreground">Output</dt>
              <dd className="mt-0.5 font-semibold">{formatTokens(execution.tokens.output)}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <dt className="text-[10px] uppercase text-muted-foreground">Total</dt>
              <dd className="mt-0.5 font-semibold">{formatTokens(execution.tokens.total)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <ExecutionSteerComposer
        disabled={!canSteer || !sessionLog.connected}
        pending={sessionLog.steerPending}
        error={sessionLog.steerError}
        onSteer={sessionLog.steerTurn}
      />

      <IssueSessionLog
        issueIdentifier={issue.identifier}
        connected={sessionLog.connected}
        entries={sessionLog.entries}
        error={sessionLog.error}
      />

      <Separator />
      <section>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assignment</div>
        <div className="mt-2 flex items-center gap-2">
          <AssigneeAvatar login={issue.assignee} />
          <span>{issue.assignee || "No agent assigned"}</span>
        </div>
      </section>
    </div>
  );
}
