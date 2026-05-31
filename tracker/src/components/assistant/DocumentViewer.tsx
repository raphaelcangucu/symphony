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
  groupLabel: string;
  Icon: LucideIcon;
}

const DOCUMENT_KIND_ORDER: readonly IssueDocumentKind[] = ["spec", "plan", "handoff"];

const DOCUMENT_KIND_CONFIG: Record<IssueDocumentKind, DocumentKindConfig> = {
  spec: { label: "Spec", groupLabel: "Specs", Icon: ScrollText },
  plan: { label: "Plan", groupLabel: "Plans", Icon: ListChecks },
  handoff: { label: "Handoff", groupLabel: "Handoff", Icon: FileText },
};

export function DocumentViewer({
  projectSlug,
  identifier,
  documents,
  available,
  reason,
}: DocumentViewerProps) {
  const visibleDocuments = useMemo(() => documents.filter(hasReadablePath), [documents]);
  const groupedDocuments = useMemo(() => groupDocumentsByKind(visibleDocuments), [visibleDocuments]);
  const orderedDocuments = useMemo(() => groupedDocuments.flatMap((group) => group.documents), [groupedDocuments]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedDocument = orderedDocuments.find((document) => document.path === selectedPath) ?? null;
  const selectedDocumentPath = selectedDocument?.path ?? null;
  const selectedDocumentUpdatedAt = selectedDocument?.updatedAt ?? null;
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (!available || orderedDocuments.length === 0) {
      setSelectedPath(null);
      return;
    }

    setSelectedPath((currentPath) => {
      if (currentPath && orderedDocuments.some((document) => document.path === currentPath)) return currentPath;
      return orderedDocuments[0].path;
    });
  }, [available, orderedDocuments]);

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

    void readIssueDocument(projectSlug, identifier, selectedDocumentPath)
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
  }, [available, identifier, projectSlug, reloadCounter, selectedDocumentPath, selectedDocumentUpdatedAt]);

  function retrySelectedDocument() {
    if (!selectedDocumentPath || loading) return;

    setReloadCounter((current) => current + 1);
  }

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
    <section className="flex h-full min-h-0 flex-1 overflow-hidden rounded-xl border bg-card" aria-label="Issue documents">
      <aside className="w-64 shrink-0 border-r bg-muted/20" aria-label="Document list">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Documents</h2>
          <p className="text-xs text-muted-foreground">Generated specs, plans, and handoffs.</p>
        </div>

        <div className="space-y-4 p-2">
          {groupedDocuments.map((group) => (
            <DocumentKindGroup
              key={group.kind}
              kind={group.kind}
              documents={group.documents}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
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
              Use Retry to load it again, or ask the assistant to regenerate the document.
            </p>
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

function DocumentKindGroup({
  kind,
  documents,
  selectedPath,
  onSelect,
}: {
  kind: IssueDocumentKind;
  documents: IssueDocument[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const { groupLabel } = DOCUMENT_KIND_CONFIG[kind];
  const headingId = `document-kind-${kind}`;

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {groupLabel}
      </h3>
      <div className="mt-1 space-y-1">
        {documents.map((document) => (
          <DocumentListItem
            key={document.path}
            document={document}
            selected={document.path === selectedPath}
            onSelect={() => onSelect(document.path)}
          />
        ))}
      </div>
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

function groupDocumentsByKind(documents: IssueDocument[]): Array<{ kind: IssueDocumentKind; documents: IssueDocument[] }> {
  return DOCUMENT_KIND_ORDER.map((kind) => ({
    kind,
    documents: documents.filter((document) => document.kind === kind),
  })).filter((group) => group.documents.length > 0);
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
