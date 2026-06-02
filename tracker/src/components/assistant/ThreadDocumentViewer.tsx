import { FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { readThreadDocument } from "@/services/threadDocuments";
import type { ThreadDocument } from "@/types/threadDocument";

export interface ThreadDocumentViewerProps {
  threadId: number;
  documents: ThreadDocument[];
  available: boolean;
  reason: string | null;
  selectedPath?: string | null;
  onSelectPath?: (path: string) => void;
}

export function ThreadDocumentViewer({
  threadId,
  documents,
  available,
  reason,
  selectedPath: selectedPathProp,
  onSelectPath,
}: ThreadDocumentViewerProps) {
  const visibleDocuments = useMemo(() => documents.filter((document) => document.path.trim()), [documents]);
  const [internalSelectedPath, setInternalSelectedPath] = useState<string | null>(null);
  const selectedPath = selectedPathProp ?? internalSelectedPath;
  const setSelectedPath = onSelectPath ?? setInternalSelectedPath;
  const selectedDocument = visibleDocuments.find((document) => document.path === selectedPath) ?? null;
  const selectedDocumentPath = selectedDocument?.path ?? null;
  const selectedDocumentUpdatedAt = selectedDocument?.updatedAt ?? null;
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (!available || visibleDocuments.length === 0) {
      if (selectedPathProp == null) setInternalSelectedPath(null);
      return;
    }

    if (selectedPathProp != null) return;

    setInternalSelectedPath((currentPath) => {
      if (currentPath && visibleDocuments.some((document) => document.path === currentPath)) return currentPath;
      return visibleDocuments[0].path;
    });
  }, [available, selectedPathProp, visibleDocuments]);

  useEffect(() => {
    if (selectedPathProp == null || !available) return;
    if (!visibleDocuments.some((document) => document.path === selectedPathProp)) return;
    setInternalSelectedPath(selectedPathProp);
  }, [available, selectedPathProp, visibleDocuments]);

  useEffect(() => {
    if (!available || !selectedDocumentPath) {
      setContent(null);
      setLoadError(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setContent(null);

    void readThreadDocument(threadId, selectedDocumentPath)
      .then((nextContent) => {
        if (!cancelled) setContent(nextContent);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [available, reloadCounter, selectedDocumentPath, selectedDocumentUpdatedAt, threadId]);

  function retrySelectedDocument() {
    if (!selectedDocumentPath || loading) return;
    setReloadCounter((current) => current + 1);
  }

  if (!available) {
    return (
      <DocumentViewerEmptyState>
        {reason === "workspace_missing"
          ? "The chat workspace is not ready yet. Generated files appear here after the assistant writes them."
          : "No files available yet."}
      </DocumentViewerEmptyState>
    );
  }

  if (visibleDocuments.length === 0) {
    return (
      <DocumentViewerEmptyState>
        Markdown drafts from this chat will appear here. Ask the assistant to create or update a file, then open it from
        the list or from a link in the conversation.
      </DocumentViewerEmptyState>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-1 overflow-hidden rounded-xl border bg-card" aria-label="Chat files">
      <aside className="w-64 shrink-0 border-r bg-muted/20" aria-label="Chat file list">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Files</h2>
          <p className="text-xs text-muted-foreground">Markdown drafts written in this conversation.</p>
        </div>

        <div className="space-y-1 p-2">
          {visibleDocuments.map((document) => (
            <Button
              key={document.path}
              type="button"
              variant="ghost"
              className={cn(
                "h-auto w-full justify-start gap-3 rounded-lg px-3 py-2 text-left",
                document.path === selectedPath && "bg-background text-foreground shadow-sm hover:bg-background",
              )}
              aria-current={document.path === selectedPath ? "true" : undefined}
              aria-label={document.title}
              onClick={() => setSelectedPath(document.path)}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{document.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{document.path}</span>
              </span>
            </Button>
          ))}
        </div>
      </aside>

      <article className="min-w-0 flex-1 overflow-auto p-6" aria-live="polite">
        {loading ? <DocumentContentState>Loading file...</DocumentContentState> : null}

        {!loading && loadError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Could not load this file.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={retrySelectedDocument}>
              Retry
            </Button>
          </div>
        ) : null}

        {!loading && !loadError && content ? (
          <Markdown className="max-w-none text-sm leading-7">{content}</Markdown>
        ) : null}

        {!loading && !loadError && !content ? <DocumentContentState>No content to display.</DocumentContentState> : null}
      </article>
    </section>
  );
}

function DocumentViewerEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded-xl border bg-card px-6 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function DocumentContentState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{children}</div>;
}
