import { FileText, ListChecks, ScrollText, type LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  layout?: "split" | "stacked";
}

interface DocumentKindConfig {
  label: string;
  groupLabel: string;
  Icon: LucideIcon;
}

const DOCUMENT_KIND_ORDER: readonly IssueDocumentKind[] = ["spec", "plan", "handoff"];

const DOCUMENT_KIND_ICONS: Record<IssueDocumentKind, LucideIcon> = {
  spec: ScrollText,
  plan: ListChecks,
  handoff: FileText,
};

function documentKindConfig(kind: IssueDocumentKind, t: TFunction): DocumentKindConfig {
  return {
    label: t(`assistant.documents.kinds.${kind}.label`),
    groupLabel: t(`assistant.documents.kinds.${kind}.group`),
    Icon: DOCUMENT_KIND_ICONS[kind],
  };
}

export function DocumentViewer({
  projectSlug,
  identifier,
  documents,
  available,
  reason,
  layout = "split",
}: DocumentViewerProps) {
  const { t } = useTranslation();
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
          ? t("assistant.documents.workspaceMissing")
          : t("assistant.documents.unavailable")}
      </DocumentViewerEmptyState>
    );
  }

  if (visibleDocuments.length === 0) {
    return <DocumentViewerEmptyState>{t("assistant.documents.empty")}</DocumentViewerEmptyState>;
  }

  const contentPanel = (
    <DocumentContentPanel
      content={content}
      loading={loading}
      loadError={loadError}
      layout={layout}
      onRetry={retrySelectedDocument}
    />
  );

  if (layout === "stacked") {
    return (
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
        aria-label={t("assistant.documents.ariaLabel")}
      >
        <StackedDocumentPicker
          groupedDocuments={groupedDocuments}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
        />
        <article className="min-h-0 flex-1 overflow-auto px-6 py-5 sm:px-8" aria-live="polite">
          {contentPanel}
        </article>
      </section>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-14px_rgba(0,0,0,0.1)] ring-1 ring-black/[0.02]"
      aria-label={t("assistant.documents.ariaLabel")}
    >
      <aside
        className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border/60 bg-muted/30"
        aria-label={t("assistant.documents.listAria")}
      >
        <div className="sticky top-0 z-10 shrink-0 border-b border-border/60 bg-muted/30 px-4 py-3 backdrop-blur-sm">
          <h2 className="text-sm font-semibold tracking-tight">{t("assistant.documents.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("assistant.documents.subtitle")}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-2.5">
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

      <article className="min-w-0 flex-1 overflow-auto bg-background/40 p-6" aria-live="polite">
        {contentPanel}
      </article>
    </section>
  );
}

function StackedDocumentPicker({
  groupedDocuments,
  selectedPath,
  onSelect,
}: {
  groupedDocuments: Array<{ kind: IssueDocumentKind; documents: IssueDocument[] }>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-3"
      aria-label={t("assistant.documents.listAria")}
    >
      <div className="space-y-3">
        {groupedDocuments.map((group) => (
          <div key={group.kind}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {documentKindConfig(group.kind, t).groupLabel}
            </p>
            <div className="flex flex-wrap gap-2">
              {group.documents.map((document) => (
                <DocumentListItem
                  key={document.path}
                  document={document}
                  selected={document.path === selectedPath}
                  onSelect={() => onSelect(document.path)}
                  compact
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentContentPanel({
  content,
  loading,
  loadError,
  layout,
  onRetry,
}: {
  content: string | null;
  loading: boolean;
  loadError: boolean;
  layout: "split" | "stacked";
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {loading ? <DocumentContentState>{t("assistant.documents.loading")}</DocumentContentState> : null}

      {!loading && loadError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="text-sm font-medium text-destructive">{t("assistant.documents.loadError")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("assistant.documents.loadErrorHint")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3 rounded-lg" onClick={onRetry}>
            {t("assistant.documents.retry")}
          </Button>
        </div>
      ) : null}

      {!loading && !loadError && content ? (
        <Markdown
          className={cn(
            "mx-auto w-full text-foreground",
            layout === "stacked" ? "max-w-4xl text-[15px] leading-8" : "max-w-3xl text-sm leading-7",
          )}
        >
          {content}
        </Markdown>
      ) : null}

      {!loading && !loadError && !content ? (
        <DocumentContentState>{t("assistant.documents.noContent")}</DocumentContentState>
      ) : null}
    </>
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
  const { t } = useTranslation();
  const { groupLabel } = documentKindConfig(kind, t);
  const headingId = `document-kind-${kind}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-center gap-2 px-2">
        <h3
          id={headingId}
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80"
        >
          {groupLabel}
        </h3>
        <span
          aria-hidden
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium text-muted-foreground"
        >
          {documents.length}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
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
  compact = false,
}: {
  document: IssueDocument;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { Icon, label } = documentKindConfig(document.kind, t);

  if (compact) {
    return (
      <Button
        type="button"
        variant={selected ? "default" : "outline"}
        size="sm"
        className={cn(
          "h-auto max-w-full shrink-0 justify-start gap-2 rounded-full px-3 py-1.5 text-left",
          !selected && "bg-background/80",
        )}
        aria-current={selected ? "true" : undefined}
        aria-label={t("assistant.documents.itemAria", { label, title: document.title })}
        onClick={onSelect}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-sm font-medium">{document.title}</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "group relative h-auto w-full justify-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
        selected
          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60 hover:bg-background"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
      aria-current={selected ? "true" : undefined}
      aria-label={t("assistant.documents.itemAria", { label, title: document.title })}
      onClick={onSelect}
    >
      {selected ? (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
      ) : null}
      <span
        aria-hidden
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          selected ? "bg-primary/10 text-primary" : "bg-muted/70 text-muted-foreground group-hover:text-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">{document.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{label}</span>
          {document.updatedAt ? (
            <>
              <span aria-hidden className="h-0.5 w-0.5 rounded-full bg-muted-foreground/50" />
              <span>{formatUpdatedAt(document.updatedAt)}</span>
            </>
          ) : null}
        </span>
      </span>
    </Button>
  );
}

function DocumentViewerEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/60 px-6 py-10 text-center shadow-sm backdrop-blur-sm">
      <span aria-hidden className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FileText className="h-5 w-5" />
      </span>
      <p className="max-w-xs text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function DocumentContentState({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
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
