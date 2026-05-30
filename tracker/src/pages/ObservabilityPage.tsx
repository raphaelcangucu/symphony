import { useEffect, useMemo, useState } from "react";

import { useObservability } from "@/hooks/useObservability";
import type { GlobalRunningRow, RuntimeObservability } from "@/types/observability";

function formatRuntime(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return "--";
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return "--";
  const seconds = Math.max(Math.floor((nowMs - started) / 1000), 0);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function flattenRows(runtimes: RuntimeObservability[]): GlobalRunningRow[] {
  return runtimes.flatMap((runtime) =>
    runtime.running.map((session) => ({
      ...session,
      runtimeId: runtime.runtimeId,
      runtimeLabel: runtime.label,
      projectSlug: runtime.projectSlug,
    })),
  );
}

export function ObservabilityPage() {
  const { runtimes, loading } = useObservability();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const rows = useMemo(() => flattenRows(runtimes), [runtimes]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Observability</h1>
        <p className="text-sm text-muted-foreground">Live runtime state across all reporting Symphony processes.</p>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading runtimes…</p> : null}
      {!loading && runtimes.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No runtimes are reporting yet.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {runtimes.map((runtime) => (
          <article key={runtime.runtimeId} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="truncate font-medium">{runtime.label}</h2>
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
                    <td className="p-2">{row.runtimeLabel}</td>
                    <td className="p-2 font-medium">{row.issueIdentifier}</td>
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
    </div>
  );
}
