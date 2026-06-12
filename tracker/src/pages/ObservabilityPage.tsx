import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useObservability } from "@/hooks/useObservability";
import { usePrMonitorObservability } from "@/hooks/usePrMonitorObservability";
import { issuePath, withAgentSection } from "@/lib/workspaceRoutes";
import { listProjects } from "@/services/projects";
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

function formatAgo(at: string | null, nowMs: number): string {
  if (!at) return "never";
  const ts = Date.parse(at);
  if (Number.isNaN(ts)) return "never";
  const seconds = Math.max(Math.floor((nowMs - ts) / 1000), 0);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
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
  const { runtimes, loading } = useObservability();
  const { data: prMonitor } = usePrMonitorObservability();
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
  const prMonitorEvaluations = useMemo(() => {
    const evaluations = prMonitor?.evaluations ?? [];
    if (selectedProject === ALL_PROJECTS) return evaluations;
    return evaluations.filter((evaluation) => evaluation.projectSlug === selectedProject);
  }, [prMonitor, selectedProject]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Observability</h1>
          <p className="text-sm text-muted-foreground">Live runtime state across all reporting Symphony processes.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Project</span>
          <select
            value={selectedProject}
            onChange={(event) => setSelectedProject(event.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading runtimes…</p> : null}
      {!loading && visibleRuntimeViews.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {runtimes.length === 0 ? "No runtimes are reporting yet." : "No runtimes match this project filter."}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleRuntimeViews.map(({ runtime, project }) => (
          <article key={runtime.runtimeId} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
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
                <dt className="text-xs text-muted-foreground">Running</dt>
                <dd className="font-medium tabular-nums">{runtime.counts.running}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Retrying</dt>
                <dd className="font-medium tabular-nums">{runtime.counts.retrying}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total tokens</dt>
                <dd className="font-medium tabular-nums">{runtime.agentTotals.totalTokens.toLocaleString()}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <section className="rounded-lg border">
        <div className="border-b p-3">
          <h2 className="font-medium">Running sessions</h2>
          <p className="text-xs text-muted-foreground">All active sessions across runtimes.</p>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="p-2">Project</th>
                  <th className="p-2">Issue</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Runtime / turns</th>
                  <th className="p-2">Agent update</th>
                  <th className="p-2">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.runtimeId}:${row.issueIdentifier}`} className="border-t">
                    <td className="p-2">{row.projectLabel}</td>
                    <td className="p-2 font-medium">
                      {row.resolvedProjectSlug && row.issueIdentifier.trim() ? (
                        <Link
                          className="text-primary underline-offset-2 hover:underline"
                          to={withAgentSection(
                            issuePath(row.resolvedProjectSlug, "board", row.issueIdentifier, "agent"),
                            "",
                            "execution",
                          )}
                        >
                          {row.issueIdentifier}
                        </Link>
                      ) : (
                        row.issueIdentifier
                      )}
                    </td>
                    <td className="p-2">{row.state ?? "--"}</td>
                    <td className="p-2 tabular-nums">
                      {formatRuntime(row.startedAt, nowMs)}
                      {row.turnCount > 0 ? ` / ${row.turnCount}` : ""}
                    </td>
                    <td className="p-2">{row.lastMessage ?? row.lastEvent ?? "--"}</td>
                    <td className="p-2 tabular-nums">{row.tokens.totalTokens.toLocaleString()}</td>
                  </tr>
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

const PR_MONITOR_EVENT_LABELS: Record<string, string> = {
  none: "no change",
  merged: "PR merged",
  ci_failure: "CI failure",
  review_findings: "review findings",
};

const PR_MONITOR_ACTION_LABELS: Record<string, string> = {
  moved_to_done: "→ Done",
  moved_to_rework: "→ Rework",
  limit_reached: "limit reached",
  kept_human_review: "kept in Human Review",
};

function prMonitorEventLabel(event: string | null): string {
  if (!event) return "--";
  return PR_MONITOR_EVENT_LABELS[event] ?? event;
}

function prMonitorActionLabel(action: string | null): string {
  if (!action) return "--";
  return PR_MONITOR_ACTION_LABELS[action] ?? action;
}

interface PrMonitorSectionProps {
  heartbeat: PrMonitorHeartbeat | null;
  evaluations: PrMonitorEvaluation[];
  nowMs: number;
}

function PrMonitorSection({ heartbeat, evaluations, nowMs }: PrMonitorSectionProps) {
  const online = heartbeat?.running ?? false;
  const tickFailed = heartbeat?.lastTickStatus === "error";

  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b p-3">
        <div>
          <h2 className="font-medium">PR monitor</h2>
          <p className="text-xs text-muted-foreground">
            Background follow-up of PRs for issues in wait states (merge → Done, CI/review → Rework).
          </p>
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
          {online ? (tickFailed ? "degraded" : "running") : "offline"}
        </span>
      </div>

      {heartbeat ? (
        <dl className="grid grid-cols-2 gap-3 p-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-xs text-muted-foreground">Last tick</dt>
            <dd className="font-medium tabular-nums">{formatAgo(heartbeat.lastTickFinishedAt, nowMs)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">In-flight</dt>
            <dd className="font-medium tabular-nums">{heartbeat.inFlight}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Evaluated last tick</dt>
            <dd className="font-medium tabular-nums">{heartbeat.lastEvaluatedCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ticks</dt>
            <dd className="font-medium tabular-nums">{heartbeat.tickCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Interval</dt>
            <dd className="font-medium tabular-nums">{Math.round(heartbeat.intervalMs / 1000)}s</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last tick status</dt>
            <dd className="font-medium">{heartbeat.lastTickStatus ?? "--"}</dd>
          </div>
        </dl>
      ) : (
        <p className="p-3 text-sm text-muted-foreground">Heartbeat unavailable.</p>
      )}

      {heartbeat?.lastError ? (
        <p className="border-t px-3 py-2 text-xs text-amber-600">Last error: {heartbeat.lastError}</p>
      ) : null}

      <div className="border-t">
        {evaluations.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No PR evaluations recorded yet.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="p-2">Project</th>
                  <th className="p-2">Issue</th>
                  <th className="p-2">PR</th>
                  <th className="p-2">Event</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Checked</th>
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
                          link
                        </a>
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="p-2">{prMonitorEventLabel(evaluation.lastEvent)}</td>
                    <td className="p-2">
                      {prMonitorActionLabel(evaluation.lastAction)}
                      {evaluation.autoReworkCount > 0 ? ` (${evaluation.autoReworkCount})` : ""}
                    </td>
                    <td className="p-2 tabular-nums">{formatAgo(evaluation.lastCheckedAt, nowMs)}</td>
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
