import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { FreeformAssistantPanel } from "@/components/assistant/FreeformAssistantPanel";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateFreeformChat } from "@/hooks/useCreateFreeformChat";
import { useRecents } from "@/hooks/useRecents";
import type { RecentSession } from "@/types/recents";

const CONVERSATIONS_LIMIT = 50;

function parseThreadId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function matchesQuery(session: RecentSession, query: string): boolean {
  if (!query) return true;

  const haystack = [
    session.title,
    session.preview ?? "",
    session.identifier ?? "",
    session.projectName ?? "",
    session.projectSlug ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function ConversationsView() {
  const { sessions, loading, refetch } = useRecents({ limit: CONVERSATIONS_LIMIT });
  const { creating, createChat } = useCreateFreeformChat(() => void refetch());
  const [query, setQuery] = useState("");

  const chatSessions = useMemo(() => sessions.filter((session) => session.kind === "chat"), [sessions]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () => chatSessions.filter((session) => matchesQuery(session, normalizedQuery)),
    [chatSessions, normalizedQuery],
  );

  return (
    <section className="flex h-full flex-col" aria-label="Conversations">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
        <h1 className="text-base font-semibold">Conversations</h1>
        <Button type="button" size="sm" onClick={() => void createChat()} disabled={creating}>
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>

      <div className="border-b px-6 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations..."
            aria-label="Search conversations"
            className="pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {loading && chatSessions.length === 0 ? (
          <div className="space-y-2 px-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : null}

        {!loading && chatSessions.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No conversations yet. Start a new one.</p>
        ) : null}

        {!loading && chatSessions.length > 0 && filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No conversations match your search.</p>
        ) : null}

        <ul className="space-y-1">
          {filtered.map((session) => (
            <li key={session.id}>
              <Link
                to={recentSessionPath(session)}
                className="flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-accent"
              >
                <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{session.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{recentSessionSubtitle(session)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function AssistantPage() {
  const { threadId: threadIdParam } = useParams<{ threadId: string }>();
  const selectedThreadId = parseThreadId(threadIdParam);

  if (selectedThreadId == null) return <ConversationsView />;

  return <FreeformAssistantPanel key={selectedThreadId} threadId={selectedThreadId} />;
}
