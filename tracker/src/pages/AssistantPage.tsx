import { Plus, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { FreeformAssistantPanel } from "@/components/assistant/FreeformAssistantPanel";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useArchiveChat } from "@/hooks/useArchiveChat";
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

function ConversationsView({
  sessions,
  loading,
  refetch,
  archiving,
  onArchive,
}: {
  sessions: RecentSession[];
  loading: boolean;
  refetch: () => Promise<void>;
  archiving: boolean;
  onArchive: (threadId: number) => void;
}) {
  const { t } = useTranslation();
  const { creating, createChat } = useCreateFreeformChat(() => void refetch());
  const [query, setQuery] = useState("");

  const chatSessions = useMemo(() => sessions.filter((session) => session.kind === "chat"), [sessions]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () => chatSessions.filter((session) => matchesQuery(session, normalizedQuery)),
    [chatSessions, normalizedQuery],
  );

  return (
    <section className="flex h-full flex-col" aria-label={t("assistant.page.conversationsAria")}>
      <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
        <h1 className="text-base font-semibold">{t("assistant.page.title")}</h1>
        <Button type="button" size="sm" onClick={() => void createChat()} disabled={creating}>
          <Plus className="h-4 w-4" />
          {t("assistant.page.newChat")}
        </Button>
      </div>

      <div className="border-b px-6 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("assistant.page.searchPlaceholder")}
            aria-label={t("assistant.page.searchAria")}
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
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("assistant.page.empty")}</p>
        ) : null}

        {!loading && chatSessions.length > 0 && filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("assistant.page.noMatch")}</p>
        ) : null}

        <ul className="space-y-1">
          {filtered.map((session) => (
            <li key={session.id} className="group flex items-start gap-1 rounded-md hover:bg-accent">
              <Link
                to={recentSessionPath(session)}
                className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5"
              >
                <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{session.title}</span>
                    {session.agentKind ? (
                      <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                        {agentKindLabel(session.agentKind, t)}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{recentSessionSubtitle(session, t)}</span>
                </span>
              </Link>
              {session.threadId != null ? (
                <ArchiveChatButton
                  threadId={session.threadId}
                  archiving={archiving}
                  onArchive={onArchive}
                  className="mr-1 mt-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                />
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function AssistantPage() {
  const navigate = useNavigate();
  const { threadId: threadIdParam } = useParams<{ threadId: string }>();
  const selectedThreadId = parseThreadId(threadIdParam);
  const { sessions, loading, refetch } = useRecents({ limit: CONVERSATIONS_LIMIT });
  const { archiving, archiveChat } = useArchiveChat(() => void refetch());

  const handleArchive = useCallback(
    (threadId: number) => {
      void archiveChat(threadId);
    },
    [archiveChat],
  );

  const handleArchiveOpenChat = useCallback(() => {
    if (selectedThreadId == null) return;
    void (async () => {
      const archived = await archiveChat(selectedThreadId);
      if (archived) navigate("/assistant");
    })();
  }, [archiveChat, navigate, selectedThreadId]);

  if (selectedThreadId == null) {
    return (
      <ConversationsView
        sessions={sessions}
        loading={loading}
        refetch={refetch}
        archiving={archiving}
        onArchive={handleArchive}
      />
    );
  }

  return (
    <FreeformAssistantPanel
      key={selectedThreadId}
      threadId={selectedThreadId}
      archiving={archiving}
      onArchive={handleArchiveOpenChat}
    />
  );
}
