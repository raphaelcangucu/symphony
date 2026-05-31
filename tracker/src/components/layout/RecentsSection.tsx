import { Link } from "react-router-dom";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { recentSessionPath } from "@/components/layout/recentSessionPath";
import { useRecents } from "@/hooks/useRecents";
import type { RecentSession } from "@/types/recents";

function subtitle(session: RecentSession): string {
  if (session.kind === "codex") {
    return [session.identifier, session.projectName ?? session.projectSlug].filter(Boolean).join(" · ");
  }
  if (session.scope === "freeform") return "Freeform chat";
  return session.projectName ?? session.projectSlug ?? "Project chat";
}

export function RecentsSection() {
  const { sessions, loading } = useRecents();

  return (
    <div className="mb-3">
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recents</div>
      <div className="max-h-48 space-y-1 overflow-auto">
        {loading && sessions.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
        ) : null}
        {!loading && sessions.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No recent sessions yet.</div>
        ) : null}
        {sessions.map((session) => (
          <Link
            key={session.id}
            to={recentSessionPath(session)}
            className="flex items-start gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{session.title}</span>
              <span className="block truncate text-xs opacity-70">{subtitle(session)}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
