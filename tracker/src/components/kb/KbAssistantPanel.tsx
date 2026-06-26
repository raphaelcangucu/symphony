import { FileText, X } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface KbLivePageContext {
  body: string;
  selection: string;
}

interface KbAssistantPanelProps {
  projectSlug: string;
  repoSlug: string;
  pagePath: string;
  pageTitle: string;
  getContext: () => KbLivePageContext;
  onClose: () => void;
  onDocumentChanged: () => void;
  onRunningChange?: (running: boolean) => void;
  hidden?: boolean;
  onOpenDocumentPath?: (path: string) => void;
}

/**
 * Notion-style docked AI side panel for the knowledge base editor. It binds the
 * reusable chat to the page's `assistant:kb:*` thread and injects a live snapshot
 * of the open document (body + current selection) into every message so the
 * assistant always reasons over what the user is actually looking at.
 */
export function KbAssistantPanel({
  projectSlug,
  repoSlug,
  pagePath,
  pageTitle,
  getContext,
  onClose,
  onDocumentChanged,
  onRunningChange,
  hidden = false,
  onOpenDocumentPath,
}: KbAssistantPanelProps) {
  const { t } = useTranslation();

  const buildExtraContext = useCallback(() => {
    const { body, selection } = getContext();
    return {
      surface: "kb",
      kb: {
        repoSlug,
        pagePath,
        title: pageTitle,
        body,
        selection,
      },
    };
  }, [getContext, repoSlug, pagePath, pageTitle]);

  return (
    <aside
      className={cn(
        "h-full w-[400px] shrink-0 flex-col border-l bg-background",
        hidden ? "hidden" : "flex",
      )}
      aria-label={t("kb.assistant.title")}
    >
      <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">{t("kb.assistant.title")}</h2>
          <p className="truncate text-xs text-muted-foreground">{t("kb.assistant.subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={t("kb.assistant.close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex items-center gap-1.5 border-b px-4 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("kb.assistant.contextLabel")}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate" title={pagePath}>
            {pageTitle}
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <ProjectAssistantPanel
          mode="embedded"
          assistantMode="kb"
          view="board"
          projectSlug={projectSlug}
          kbRepoSlug={repoSlug}
          kbPagePath={pagePath}
          getExtraContext={buildExtraContext}
          onDocumentChanged={onDocumentChanged}
          onRunningChange={onRunningChange}
          onOpenDocumentPath={onOpenDocumentPath}
        />
      </div>
    </aside>
  );
}
