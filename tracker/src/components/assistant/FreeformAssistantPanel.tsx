import { ArrowLeft } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ArchiveChatButton } from "@/components/assistant/ArchiveChatButton";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { ThreadDocumentViewer } from "@/components/assistant/ThreadDocumentViewer";
import { useThreadDocuments } from "@/hooks/useThreadDocuments";
import { cn } from "@/lib/utils";
import type { AssistantDocumentChangedPayload } from "@/services/phoenix/assistantChannel";

interface FreeformAssistantPanelProps {
  threadId: number;
  archiving?: boolean;
  onArchive?: () => void;
}

export function FreeformAssistantPanel({ threadId, archiving = false, onArchive }: FreeformAssistantPanelProps) {
  const { t } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const threadDocuments = useThreadDocuments({ threadId, refreshKey });

  const handleDocumentChanged = useCallback(
    (payload: AssistantDocumentChangedPayload) => {
      if (payload.threadId !== threadId) return;
      setRefreshKey((current) => current + 1);
    },
    [threadId],
  );

  return (
    <main
      className={cn(
        "grid h-full max-h-full gap-4 overflow-hidden bg-muted/20 p-4",
        "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.85fr)] xl:grid-rows-1",
      )}
    >
      <section
        className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm"
        aria-label={t("assistant.freeform.chatAria")}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <Link
            to="/assistant"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("assistant.freeform.backToConversations")}
          </Link>
          {onArchive ? (
            <ArchiveChatButton
              threadId={threadId}
              archiving={archiving}
              onArchive={() => onArchive()}
            />
          ) : null}
        </div>
        <ProjectAssistantPanel
          threadId={threadId}
          view="board"
          mode="page"
          onDocumentChanged={handleDocumentChanged}
          onOpenDocumentPath={setSelectedPath}
        />
      </section>

      <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden" aria-label={t("assistant.freeform.filesAria")}>
        <div className="shrink-0 rounded-xl border bg-card px-4 py-3 shadow-sm">
          <h1 className="text-sm font-semibold">{t("assistant.freeform.filesTitle")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t("assistant.freeform.filesHint")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ThreadDocumentViewer
            threadId={threadId}
            documents={threadDocuments.documents}
            available={threadDocuments.available}
            reason={threadDocuments.reason}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
          />
        </div>
      </aside>
    </main>
  );
}
