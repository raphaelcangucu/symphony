import { Plus } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { RecentStatusDot } from "@/components/layout/RecentStatusDot";
import { recentSessionPath, recentSessionSubtitle } from "@/components/layout/recentSessionPath";
import { useArchiveChat } from "@/hooks/useArchiveChat";
import { useCreateFreeformChat } from "@/hooks/useCreateFreeformChat";
import { useRecents } from "@/hooks/useRecents";

export function RecentsSection() {
  const { t } = useTranslation();
  const { sessions, loading, refetch } = useRecents();
  const { creating, createChat } = useCreateFreeformChat(() => void refetch());
  const { archiving, archiveChat } = useArchiveChat(() => void refetch());

  const handleArchive = useCallback(
    (threadId: number) => {
      void archiveChat(threadId);
    },
    [archiveChat],
  );

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("layout.recents.title")}
        </span>
        <div className="flex items-center gap-2">
          <Link
            to="/assistant"
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {t("layout.recents.seeAll")}
          </Link>
          <button
            type="button"
            onClick={() => void createChat()}
            disabled={creating}
            aria-label={t("layout.recents.newChatAria")}
            title={t("layout.recents.newChatTitle")}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="max-h-48 space-y-1 overflow-auto">
        {loading && sessions.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{t("layout.recents.loading")}</div>
        ) : null}
        {!loading && sessions.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("layout.recents.empty")}</div>
        ) : null}
        {sessions.map((session) => (
          <div key={session.id} className="group flex items-start gap-1 rounded-md hover:bg-accent">
            <Link
              to={recentSessionPath(session)}
              className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <RecentStatusDot statusKind={session.statusKind} className="mt-1.5" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{session.title}</span>
                <span className="block truncate text-xs opacity-70">{recentSessionSubtitle(session, t)}</span>
              </span>
            </Link>
            {session.kind === "chat" && session.threadId != null ? (
              <ArchiveChatButton
                threadId={session.threadId}
                archiving={archiving}
                onArchive={handleArchive}
                className="mr-0.5 mt-1 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
