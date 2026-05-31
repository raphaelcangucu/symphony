import { FileText, ListChecks, ScrollText, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { readIssueDocument } from "@/services/issueDocuments";
import type { IssueDocument, IssueDocumentKind } from "@/types/issueDocument";

export interface DocumentViewerProps {
  projectSlug: string;
  identifier: string;
  documents: IssueDocument[];
  available: boolean;
  reason: string | null;
}

interface DocumentKindConfig {
  label: string;
  Icon: LucideIcon;
}

const DOCUMENT_KIND_CONFIG: Record<IssueDocumentKind, DocumentKindConfig> = {
  spec: { label: "Spec", Icon: ScrollText },
  plan: { label: "Plan", Icon: ListChecks },
  handoff: { label: "Handoff", Icon: FileText },
};

export function DocumentViewer({
  projectSlug,
  identifier,
  documents,
  available,
  reason,
}: DocumentViewerProps) {
  const visibleDocuments = useMemo(() => documents.filter(hasReadablePath), [documents]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedDocument = visibleDocuments.find((document) => document.path === selectedPath) ?? null;
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!available || visibleDocuments.length === 0) {
      setSelectedPath(null);
      return;
    }

    setSelectedPath((currentPath) => {
      if (currentPath && visibleDocuments.some((document) => document.path === currentPath)) return currentPath;
      return visibleDocuments[0].path;
    });
  }, [available, visibleDocuments]);

  useEffect(() => {
    if (!available || !selectedDocument) {
      setContent(null);
      setLoadError(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setContent(null);

    void readIssueDocument(projectSlug, identifier, selectedDocument.path)
      .then((nextContent) => {
        if (!cancelled) {
          setContent(nextContent);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [available, identifier, projectSlug, selectedDocument]);

  if (!available) {
    return (
      <DocumentViewerEmptyState>
        {reason === "workspace_missing"
          ? "The working tree is not ready yet. Documents appear once the assistant starts working."
          : "No documents available."}
      </DocumentViewerEmptyState>
    );
  }

  if (visibleDocuments.length === 0) {
    return <DocumentViewerEmptyState>No spec or plan documents yet.</DocumentViewerEmptyState>;
  }

  return (
    <section className="flex min-h-0 overflow-hidden rounded-xl border bg-card" aria-label="Issue documents">
      <aside className="w-64 shrink-0 border-r bg-muted/20" aria-label="Document list">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Documents</h2>
          <p className="text-xs text-muted-foreground">Generated specs, plans, and handoffs.</p>
        </div>

        <div className="space-y-1 p-2">
          {visibleDocuments.map((document) => (
            <DocumentListItem
              key={document.path}
              document={document}
              selected={document.path === selectedPath}
              onSelect={() => setSelectedPath(document.path)}
            />
          ))}
        </div>
      </aside>

      <article className="min-w-0 flex-1 overflow-auto p-6" aria-live="polite">
        {loading ? <DocumentContentState>Loading document...</DocumentContentState> : null}

        {!loading && loadError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Could not load this document.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try selecting it again, or ask the assistant to regenerate the document.
            </p>
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

function DocumentListItem({
  document,
  selected,
  onSelect,
}: {
  document: IssueDocument;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Icon, label } = DOCUMENT_KIND_CONFIG[document.kind];

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "h-auto w-full justify-start gap-3 rounded-lg px-3 py-2 text-left",
        selected && "bg-background text-foreground shadow-sm hover:bg-background",
      )}
      aria-current={selected ? "true" : undefined}
      aria-label={`${label} ${document.title}`}
      onClick={onSelect}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{document.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{label}</span>
          {document.updatedAt ? <span>{formatUpdatedAt(document.updatedAt)}</span> : null}
        </span>
      </span>
    </Button>
  );
}

function DocumentViewerEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-6 py-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}

function DocumentContentState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{children}</div>;
}

function hasReadablePath(document: IssueDocument): boolean {
  return typeof document.path === "string" && document.path.trim().length > 0;
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
