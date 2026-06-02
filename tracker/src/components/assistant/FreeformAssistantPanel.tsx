import { useCallback, useState } from "react";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { ThreadDocumentViewer } from "@/components/assistant/ThreadDocumentViewer";
import { useThreadDocuments } from "@/hooks/useThreadDocuments";
import { cn } from "@/lib/utils";
import type { AssistantDocumentChangedPayload } from "@/services/phoenix/assistantChannel";

interface FreeformAssistantPanelProps {
  threadId: number;
}

export function FreeformAssistantPanel({ threadId }: FreeformAssistantPanelProps) {
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
        "grid min-h-[calc(100vh-4rem)] gap-4 bg-muted/20 p-4",
        "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.85fr)]",
      )}
    >
      <section className="min-h-0 overflow-hidden rounded-xl border bg-background shadow-sm" aria-label="Assistant chat">
        <ProjectAssistantPanel
          threadId={threadId}
          view="board"
          mode="page"
          onDocumentChanged={handleDocumentChanged}
          onOpenDocumentPath={setSelectedPath}
        />
      </section>

      <aside className="flex min-h-0 flex-col gap-3" aria-label="Assistant chat files">
        <div className="shrink-0 rounded-xl border bg-card px-4 py-3 shadow-sm">
          <h1 className="text-sm font-semibold">Conversation files</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Open markdown drafts on the right. Click a filename in the chat to jump to it here.
          </p>
        </div>

        <ThreadDocumentViewer
          threadId={threadId}
          documents={threadDocuments.documents}
          available={threadDocuments.available}
          reason={threadDocuments.reason}
          selectedPath={selectedPath}
          onSelectPath={setSelectedPath}
        />
      </aside>
    </main>
  );
}
