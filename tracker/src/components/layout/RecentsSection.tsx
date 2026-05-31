import { Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { useCreateFreeformChat } from "@/hooks/useCreateFreeformChat";
import { useRecents } from "@/hooks/useRecents";

export function RecentsSection() {
  const { sessions, loading, refetch } = useRecents();
  const { creating, createChat } = useCreateFreeformChat(() => void refetch());

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recents</span>
        <div className="flex items-center gap-2">
          <Link
            to="/assistant"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            See all
          </Link>
          <button
            type="button"
            onClick={() => void createChat()}
            disabled={creating}
            aria-label="New chat"
            title="New chat"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
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
              <span className="block truncate text-xs opacity-70">{recentSessionSubtitle(session)}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
