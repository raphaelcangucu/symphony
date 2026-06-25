import { ChevronDown, ChevronRight, Eraser, GitFork, Layers, Loader2, Pause, RotateCcw, Target } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgentExecutions } from "@/hooks/useAgentExecutions";
import { useObservability } from "@/hooks/useObservability";
import { usePrMonitorObservability } from "@/hooks/usePrMonitorObservability";
import { normalizeIssueIdentifier } from "@/lib/issueIdentifiers";
import { cn } from "@/lib/utils";
import { issuePath, withAgentSection, workspaceBasePath } from "@/lib/workspaceRoutes";
import { dispatchIssueAgent, type IssueDispatchAction } from "@/services/issueDispatch";
import { listProjects } from "@/services/projects";
import type { AgentExecution } from "@/types/agent-execution";
import type {
  GlobalRunningRow,
  PrMonitorEvaluation,
  PrMonitorHeartbeat,
  RuntimeObservability,
} from "@/types/observability";
import type { Project } from "@/types/project";

const ALL_PROJECTS = "__all__";

interface RuntimeProject {
  key: string;
  label: string;
  slug: string | null;
}

interface RuntimeView {
  runtime: RuntimeObservability;
  project: RuntimeProject;
}

interface ProjectRunningRow extends GlobalRunningRow {
  projectKey: string;
  projectLabel: string;
  resolvedProjectSlug: string | null;
}

function formatRuntime(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return "--";
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return "--";
  const seconds = Math.max(Math.floor((nowMs - started) / 1000), 0);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatAgo(at: string | null, nowMs: number, t: TFunction): string {
  if (!at) return t("observability.time.never");
  const ts = Date.parse(at);
  if (Number.isNaN(ts)) return t("observability.time.never");
  const seconds = Math.max(Math.floor((nowMs - ts) / 1000), 0);
  if (seconds < 60) return t("observability.time.secondsAgo", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("observability.time.minutesAgo", { count: minutes });
  return t("observability.time.hoursMinutesAgo", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function flattenRows(runtimeViews: RuntimeView[]): ProjectRunningRow[] {
  return runtimeViews.flatMap(({ runtime, project }) =>
    runtime.running.map((session) => ({
      ...session,
      runtimeId: runtime.runtimeId,
      runtimeLabel: runtime.label,
      projectSlug: runtime.projectSlug,
      projectKey: project.key,
      projectLabel: project.label,
      resolvedProjectSlug: project.slug,
    })),
  );
}

interface RunningRowGroup {
  parent: ProjectRunningRow;
  children: ProjectRunningRow[];
}

// Groups child_run sessions under their coordinating parent so the table renders
// a hierarchy instead of flat siblings. A child whose parent is not in the
// visible set falls back to rendering as its own top-level row.
function groupRunningRows(rows: ProjectRunningRow[]): RunningRowGroup[] {
  const byIdentifier = new Map(rows.map((row) => [normalizeIssueIdentifier(row.issueIdentifier), row]));
  const childrenByParent = new Map<string, ProjectRunningRow[]>();

  for (const row of rows) {
    if ((row.bundleRole ?? "standalone") !== "child" || !row.parentIdentifier) continue;
    const parentKey = normalizeIssueIdentifier(row.parentIdentifier);
    if (!byIdentifier.has(parentKey)) continue;
    const list = childrenByParent.get(parentKey) ?? [];
    list.push(row);
    childrenByParent.set(parentKey, list);
  }

  const attachedChildKeys = new Set(
    Array.from(childrenByParent.values()).flatMap((list) =>
      list.map((row) => normalizeIssueIdentifier(row.issueIdentifier)),
    ),
  );

  const groups: RunningRowGroup[] = [];
  for (const row of rows) {
    const key = normalizeIssueIdentifier(row.issueIdentifier);
    if (attachedChildKeys.has(key)) continue;
    groups.push({ parent: row, children: childrenByParent.get(key) ?? [] });
  }

  return groups;
}

function normalizeProjectKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveRuntimeProject(runtime: RuntimeObservability, projects: Project[]): RuntimeProject {
  const explicitSlug = runtime.projectSlug?.trim();
  if (explicitSlug) return { key: explicitSlug, label: explicitSlug, slug: explicitSlug };

  const matchedProject = findProjectForRuntime(runtime, projects);
  if (matchedProject) return { key: matchedProject.slug, label: matchedProject.slug, slug: matchedProject.slug };

  const fallbackLabel = runtime.label.trim() || runtime.runtimeId.trim() || "unknown";
  return { key: `runtime:${runtime.runtimeId || fallbackLabel}`, label: fallbackLabel, slug: null };
}

function findProjectForRuntime(runtime: RuntimeObservability, projects: Project[]): Project | null {
  const runtimeKey = normalizeProjectKey([runtime.label, runtime.runtimeId, runtime.sourceUrl ?? ""].join(" "));
  if (!runtimeKey) return null;

  return (
    projects.find((project) => {
      const slugKey = normalizeProjectKey(project.slug);
      const nameKey = normalizeProjectKey(project.name);
      return (slugKey.length > 0 && runtimeKey.includes(slugKey)) || (nameKey.length > 0 && runtimeKey.includes(nameKey));
    }) ?? null
  );
}

function projectOptions(runtimeViews: RuntimeView[]): Array<{ key: string; label: string }> {
  return Array.from(new Map(runtimeViews.map(({ project }) => [project.key, project.label])).entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function ObservabilityPage() {
  const { t } = useTranslation();
  const { runtimes, loading } = useObservability();
  const { data: prMonitor } = usePrMonitorObservability();
  const { executions } = useAgentExecutions();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState(ALL_PROJECTS);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    void listProjects({ includeArchived: true })
      .then((items) => {
        if (active) setProjects(items);
      })
      .catch(() => {
        if (active) setProjects([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const runtimeViews = useMemo<RuntimeView[]>(
    () => runtimes.map((runtime) => ({ runtime, project: resolveRuntimeProject(runtime, projects) })),
    [projects, runtimes],
  );
  const options = useMemo(() => projectOptions(runtimeViews), [runtimeViews]);

  useEffect(() => {
    if (selectedProject !== ALL_PROJECTS && !options.some((option) => option.key === selectedProject)) {
      setSelectedProject(ALL_PROJECTS);
    }
  }, [options, selectedProject]);

  const visibleRuntimeViews = useMemo(
    () =>
      selectedProject === ALL_PROJECTS
        ? runtimeViews
        : runtimeViews.filter(({ project }) => project.key === selectedProject),
    [runtimeViews, selectedProject],
  );
  const rows = useMemo(() => flattenRows(visibleRuntimeViews), [visibleRuntimeViews]);
  const runningGroups = useMemo(() => groupRunningRows(rows), [rows]);
  const prMonitorEvaluations = useMemo(() => {
    const evaluations = prMonitor?.evaluations ?? [];
    if (selectedProject === ALL_PROJECTS) return evaluations;
    return evaluations.filter((evaluation) => evaluation.projectSlug === selectedProject);
  }, [prMonitor, selectedProject]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("observability.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("observability.subtitle")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("observability.project")}</span>
          <select
            value={selectedProject}
            onChange={(event) => setSelectedProject(event.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value={ALL_PROJECTS}>{t("observability.allProjects")}</option>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">{t("observability.loadingRuntimes")}</p> : null}
      {!loading && visibleRuntimeViews.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {runtimes.length === 0 ? t("observability.noRuntimes") : t("observability.noRuntimesFilter")}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleRuntimeViews.map(({ runtime, project }) => (
          <RuntimeSummaryCard key={runtime.runtimeId} runtime={runtime} project={project} />
        ))}
      </div>

      <section className="rounded-lg border">
        <div className="border-b p-3">
          <h2 className="font-medium">{t("observability.runningSessions")}</h2>
          <p className="text-xs text-muted-foreground">{t("observability.runningSessionsHint")}</p>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("observability.noActiveSessions")}</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="p-2">{t("observability.table.project")}</th>
                  <th className="p-2">{t("observability.table.issue")}</th>
                  <th className="p-2">{t("observability.table.goal")}</th>
                  <th className="p-2">{t("observability.table.state")}</th>
                  <th className="p-2">{t("observability.table.runtimeTurns")}</th>
                  <th className="p-2">{t("observability.table.agentUpdate")}</th>
                  <th className="p-2">{t("observability.table.tokens")}</th>
                  <th className="p-2 text-right">{t("observability.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {runningGroups.map((group) => (
                  <SessionGroupRows
                    key={`${group.parent.runtimeId}:${group.parent.issueIdentifier}`}
                    group={group}
                    executions={executions}
                    nowMs={nowMs}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PrMonitorSection heartbeat={prMonitor?.heartbeat ?? null} evaluations={prMonitorEvaluations} nowMs={nowMs} />
    </div>
  );
}

function SessionIssueLink({ row }: { row: ProjectRunningRow }) {
  if (row.resolvedProjectSlug && row.issueIdentifier.trim()) {
    return (
      <Link
        className="text-primary underline-offset-2 hover:underline"
        to={withAgentSection(issuePath(row.resolvedProjectSlug, "board", row.issueIdentifier, "agent"), "", "execution")}
      >
        {row.issueIdentifier}
      </Link>
    );
  }
  return <>{row.issueIdentifier}</>;
}

function SessionRowCells({
  row,
  executions,
  nowMs,
}: {
  row: ProjectRunningRow;
  executions: ReadonlyMap<string, AgentExecution>;
  nowMs: number;
}) {
  return (
    <>
      <td className="p-2">
        <GoalCell execution={executions.get(normalizeIssueIdentifier(row.issueIdentifier))} />
      </td>
      <td className="p-2">{row.state ?? "--"}</td>
      <td className="p-2 tabular-nums">
        {formatRuntime(row.startedAt, nowMs)}
        {row.turnCount > 0 ? ` / ${row.turnCount}` : ""}
      </td>
      <td className="p-2">{row.lastMessage ?? row.lastEvent ?? "--"}</td>
      <td className="p-2 tabular-nums">{row.tokens.totalTokens.toLocaleString()}</td>
      <td className="p-2">
        <SessionRowActions projectSlug={row.resolvedProjectSlug} identifier={row.issueIdentifier} />
      </td>
    </>
  );
}

function SessionGroupRows({
  group,
  executions,
  nowMs,
  t,
}: {
  group: RunningRowGroup;
  executions: ReadonlyMap<string, AgentExecution>;
  nowMs: number;
  t: TFunction;
}) {
  const { parent, children } = group;
  const [expanded, setExpanded] = useState(true);
  const hasChildren = children.length > 0;

  return (
    <>
      <tr className="border-t">
        <td className="p-2">{parent.projectLabel}</td>
        <td className="p-2 font-medium">
          <div className="flex items-center gap-1.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={expanded ? t("observability.childRuns.hide") : t("observability.childRuns.show")}
                title={t("observability.childRuns.count", { count: children.length })}
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : null}
            <SessionIssueLink row={parent} />
            {hasChildren ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Layers className="h-3 w-3" />
                {children.length}
              </span>
            ) : null}
          </div>
        </td>
        <SessionRowCells row={parent} executions={executions} nowMs={nowMs} />
      </tr>
      {hasChildren && expanded
        ? children.map((child) => (
            <tr key={`${child.runtimeId}:${child.issueIdentifier}`} className="border-t bg-muted/20">
              <td className="p-2" />
              <td className="p-2 font-medium">
                <div className="flex items-center gap-1.5 pl-5">
                  <SessionIssueLink row={child} />
                  {child.repo ? (
                    <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                      <GitFork className="h-3 w-3" />
                      {child.repo}
                    </span>
                  ) : null}
                </div>
              </td>
              <SessionRowCells row={child} executions={executions} nowMs={nowMs} />
            </tr>
          ))
        : null}
    </>
  );
}

function RuntimeSummaryCard({ runtime, project }: RuntimeView) {
  const { t } = useTranslation();

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate font-medium">{project.label}</h2>
        <span
          className={
            runtime.status === "online"
              ? "rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-600"
              : "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600"
          }
        >
          {runtime.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {runtime.trackerKind ?? "?"} · {runtime.agentKind ?? "?"}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t("observability.running")}</dt>
          <dd className="font-medium tabular-nums">{runtime.counts.running}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("observability.retrying")}</dt>
          <dd className="font-medium tabular-nums">{runtime.counts.retrying}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("observability.totalTokens")}</dt>
          <dd className="font-medium tabular-nums">{runtime.agentTotals.totalTokens.toLocaleString()}</dd>
        </div>
      </dl>
    </>
  );

  const cardClassName = "rounded-lg border bg-card p-4";

  if (!project.slug) {
    return <article className={cardClassName}>{body}</article>;
  }

  return (
    <Link
      to={workspaceBasePath(project.slug, "board")}
      title={t("observability.openBoard")}
      className={cn(
        cardClassName,
        "block transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {body}
    </Link>
  );
}

function GoalCell({ execution }: { execution?: AgentExecution }) {
  const { t } = useTranslation();
  const objective = execution?.goal?.objective?.trim();
  if (!objective) return <span className="text-muted-foreground">--</span>;

  const running = execution?.status === "live" || execution?.status === "retrying";

  return (
    <span
      title={t("observability.pursuingGoal", { objective })}
      className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300"
    >
      {running ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <Target className="h-3 w-3 shrink-0" />
      )}
      <span className="truncate">{objective}</span>
    </span>
  );
}

type ConfirmAction = "restart" | "hard_reset";

function confirmCopy(t: TFunction, action: ConfirmAction): { title: string; description: string; cta: string } {
  if (action === "restart") {
    return {
      title: t("observability.session.restartDialogTitle"),
      description: t("observability.session.restartDialogDescription"),
      cta: t("observability.session.restart"),
    };
  }
  return {
    title: t("observability.session.hardResetDialogTitle"),
    description: t("observability.session.hardResetDialogDescription"),
    cta: t("observability.session.hardReset"),
  };
}

function SessionRowActions({ projectSlug, identifier }: { projectSlug: string | null; identifier: string }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<IssueDispatchAction | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  const disabled = !projectSlug || !identifier.trim();

  async function run(action: IssueDispatchAction) {
    if (!projectSlug) return;
    setPending(action);
    try {
      const result = await dispatchIssueAgent(projectSlug, identifier, { action });
      toast.success(result.message || `${identifier}: ${action}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("observability.session.dispatchFailed", { action, identifier }));
    } finally {
      setPending(null);
      setConfirm(null);
    }
  }

  const busy = pending !== null;

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        disabled={disabled || busy}
        title={disabled ? t("observability.session.noProjectMapping") : t("observability.session.pauseTitle")}
        onClick={() => void run("stop")}
      >
        <Pause className="mr-1 h-3.5 w-3.5" />
        {pending === "stop" ? t("observability.session.pausing") : t("observability.session.pause")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        disabled={disabled || busy}
        title={disabled ? t("observability.session.noProjectMapping") : t("observability.session.restartTitle")}
        onClick={() => setConfirm("restart")}
      >
        <RotateCcw className="mr-1 h-3.5 w-3.5" />
        {pending === "restart" ? t("observability.session.restarting") : t("observability.session.restart")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-destructive hover:text-destructive"
        disabled={disabled || busy}
        title={disabled ? t("observability.session.noProjectMapping") : t("observability.session.hardResetTitle")}
        onClick={() => setConfirm("hard_reset")}
      >
        <Eraser className="mr-1 h-3.5 w-3.5" />
        {pending === "hard_reset" ? t("observability.session.resetting") : t("observability.session.hardReset")}
      </Button>

      <Dialog open={confirm !== null} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <DialogContent>
          {confirm ? (
            <>
              <DialogHeader>
                <DialogTitle>{confirmCopy(t, confirm).title}</DialogTitle>
                <DialogDescription>
                  {identifier}: {confirmCopy(t, confirm).description}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" size="sm">
                    {t("observability.session.cancel")}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void run(confirm)}
                >
                  {confirm === "hard_reset" ? <Eraser className="mr-1.5 h-3.5 w-3.5" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                  {confirmCopy(t, confirm).cta}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PR_MONITOR_EVENT_KEYS = new Set(["none", "merged", "ci_failure", "review_findings"]);
const PR_MONITOR_ACTION_KEYS = new Set(["moved_to_done", "moved_to_rework", "limit_reached", "kept_human_review"]);

function prMonitorEventLabel(event: string | null, t: TFunction): string {
  if (!event) return "--";
  if (PR_MONITOR_EVENT_KEYS.has(event)) return t(`observability.prMonitor.events.${event}`);
  return event;
}

function prMonitorActionLabel(action: string | null, t: TFunction): string {
  if (!action) return "--";
  if (PR_MONITOR_ACTION_KEYS.has(action)) return t(`observability.prMonitor.actions.${action}`);
  return action;
}

interface PrMonitorSectionProps {
  heartbeat: PrMonitorHeartbeat | null;
  evaluations: PrMonitorEvaluation[];
  nowMs: number;
}

function PrMonitorSection({ heartbeat, evaluations, nowMs }: PrMonitorSectionProps) {
  const { t } = useTranslation();
  const online = heartbeat?.running ?? false;
  const tickFailed = heartbeat?.lastTickStatus === "error";

  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b p-3">
        <div>
          <h2 className="font-medium">{t("observability.prMonitor.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("observability.prMonitor.subtitle")}</p>
        </div>
        <span
          className={
            online && !tickFailed
              ? "rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-600"
              : online && tickFailed
                ? "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600"
                : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          }
        >
          {online ? (tickFailed ? t("observability.prMonitor.degraded") : t("observability.prMonitor.running")) : t("observability.prMonitor.offline")}
        </span>
      </div>

      {heartbeat ? (
        <dl className="grid grid-cols-2 gap-3 p-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-xs text-muted-foreground">{t("observability.prMonitor.lastTick")}</dt>
            <dd className="font-medium tabular-nums">{formatAgo(heartbeat.lastTickFinishedAt, nowMs, t)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("observability.prMonitor.inFlight")}</dt>
            <dd className="font-medium tabular-nums">{heartbeat.inFlight}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("observability.prMonitor.evaluatedLastTick")}</dt>
            <dd className="font-medium tabular-nums">{heartbeat.lastEvaluatedCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("observability.prMonitor.ticks")}</dt>
            <dd className="font-medium tabular-nums">{heartbeat.tickCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("observability.prMonitor.interval")}</dt>
            <dd className="font-medium tabular-nums">{Math.round(heartbeat.intervalMs / 1000)}s</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("observability.prMonitor.lastTickStatus")}</dt>
            <dd className="font-medium">{heartbeat.lastTickStatus ?? "--"}</dd>
          </div>
        </dl>
      ) : (
        <p className="p-3 text-sm text-muted-foreground">{t("observability.prMonitor.heartbeatUnavailable")}</p>
      )}

      {heartbeat?.lastError ? (
        <p className="border-t px-3 py-2 text-xs text-amber-600">{t("observability.prMonitor.lastError", { error: heartbeat.lastError })}</p>
      ) : null}

      <div className="border-t">
        {evaluations.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("observability.prMonitor.noEvaluations")}</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="p-2">{t("observability.table.project")}</th>
                  <th className="p-2">{t("observability.table.issue")}</th>
                  <th className="p-2">PR</th>
                  <th className="p-2">{t("observability.prMonitor.event")}</th>
                  <th className="p-2">{t("observability.prMonitor.action")}</th>
                  <th className="p-2">{t("observability.prMonitor.checked")}</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((evaluation) => (
                  <tr key={`${evaluation.projectSlug}:${evaluation.issueIdentifier}:${evaluation.prUrl}`} className="border-t">
                    <td className="p-2">{evaluation.projectSlug ?? "--"}</td>
                    <td className="p-2 font-medium">
                      {evaluation.projectSlug && evaluation.issueIdentifier.trim() ? (
                        <Link
                          className="text-primary underline-offset-2 hover:underline"
                          to={withAgentSection(
                            issuePath(evaluation.projectSlug, "board", evaluation.issueIdentifier, "agent"),
                            "",
                            "execution",
                          )}
                        >
                          {evaluation.issueIdentifier}
                        </Link>
                      ) : (
                        evaluation.issueIdentifier || "--"
                      )}
                    </td>
                    <td className="p-2">
                      {evaluation.prUrl ? (
                        <a
                          className="text-primary underline-offset-2 hover:underline"
                          href={evaluation.prUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("observability.prMonitor.prLink")}
                        </a>
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="p-2">{prMonitorEventLabel(evaluation.lastEvent, t)}</td>
                    <td className="p-2">
                      {prMonitorActionLabel(evaluation.lastAction, t)}
                      {evaluation.autoReworkCount > 0 ? ` (${evaluation.autoReworkCount})` : ""}
                    </td>
                    <td className="p-2 tabular-nums">{formatAgo(evaluation.lastCheckedAt, nowMs, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
