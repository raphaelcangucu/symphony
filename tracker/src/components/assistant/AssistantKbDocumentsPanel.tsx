import { FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { useKbAllRepoTrees } from "@/hooks/useKbAllRepoTrees";
import { useKbPage } from "@/hooks/useKbPage";
import { useKbProjectOverview } from "@/hooks/useKbProjectOverview";
import { normalizeKbDocumentReference } from "@/lib/assistantKbReferences";
import { cn } from "@/lib/utils";
import type { KbTreeNode } from "@/types/knowledgeBase";

interface AssistantKbDocumentsPanelProps {
  projectSlug: string;
  citedPaths: string[];
  requestedPath?: string | null;
  className?: string;
}

interface AssistantKbPageItem {
  key: string;
  repoSlug: string;
  repoLabel: string;
  path: string;
  title: string;
}

type KbDocumentFilter = "cited" | "all";

export function AssistantKbDocumentsPanel({
  projectSlug,
  citedPaths,
  requestedPath = null,
  className,
}: AssistantKbDocumentsPanelProps) {
  const { t } = useTranslation();
  const { overview, loading: overviewLoading } = useKbProjectOverview(projectSlug);
  const repoSlugs = useMemo(() => overview?.repositories.map((repo) => repo.repoSlug) ?? [], [overview]);
  const { treesByRepo, loading: treesLoading } = useKbAllRepoTrees(projectSlug, repoSlugs);
  const citedPathSet = useMemo(() => normalizeReferenceSet(citedPaths), [citedPaths]);
  const [filter, setFilter] = useState<KbDocumentFilter>(() => (citedPathSet.size > 0 ? "cited" : "all"));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const allPages = useMemo<AssistantKbPageItem[]>(() => {
    if (!overview) return [];

    return overview.repositories.flatMap((repo) =>
      flattenPages(treesByRepo[repo.repoSlug] ?? [], {
        repoSlug: repo.repoSlug,
        repoLabel: repo.workspacePath,
      }),
    );
  }, [overview, treesByRepo]);

  const visiblePages = useMemo(() => {
    if (filter !== "cited" || citedPathSet.size === 0) return allPages;
    return allPages.filter((page) => citedPathSet.has(page.path));
  }, [allPages, citedPathSet, filter]);

  const selectedPage = visiblePages.find((page) => page.key === selectedKey) ?? null;
  const { page, loading: pageLoading, error: pageError } = useKbPage(
    projectSlug,
    selectedPage?.repoSlug ?? null,
    selectedPage?.path ?? null,
  );
  const loading = overviewLoading || treesLoading;

  useEffect(() => {
    if (citedPathSet.size === 0 && filter === "cited") setFilter("all");
  }, [citedPathSet, filter]);

  useEffect(() => {
    const normalizedRequestedPath = normalizeKbDocumentReference(requestedPath);
    if (!normalizedRequestedPath) return;

    const requestedPage = allPages.find((candidate) => candidate.path === normalizedRequestedPath);
    if (requestedPage) setSelectedKey(requestedPage.key);
  }, [allPages, requestedPath]);

  useEffect(() => {
    setSelectedKey((current) => {
      if (current && visiblePages.some((pageItem) => pageItem.key === current)) return current;
      return visiblePages[0]?.key ?? null;
    });
  }, [visiblePages]);

  return (
    <section
      className={cn("flex h-full min-h-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm", className)}
      aria-label={t("kb.assistantDocuments.ariaLabel")}
    >
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border/60 bg-muted/30">
        <div className="shrink-0 border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">{t("kb.assistantDocuments.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("kb.assistantDocuments.subtitle", { count: citedPathSet.size })}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-background/70 p-1">
            <FilterButton active={filter === "cited"} disabled={citedPathSet.size === 0} onClick={() => setFilter("cited")}>
              {t("kb.assistantDocuments.cited")}
            </FilterButton>
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
              {t("kb.assistantDocuments.all")}
            </FilterButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("kb.loading")}</p> : null}

          {!loading && visiblePages.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {filter === "cited"
                ? t("kb.assistantDocuments.noCitedMatches")
                : t("kb.assistantDocuments.empty")}
            </p>
          ) : null}

          <div className="space-y-1">
            {visiblePages.map((pageItem) => (
              <Button
                key={pageItem.key}
                type="button"
                variant="ghost"
                aria-label={pageItem.title}
                aria-current={pageItem.key === selectedKey ? "true" : undefined}
                className={cn(
                  "h-auto w-full justify-start gap-3 rounded-xl px-2.5 py-2 text-left",
                  pageItem.key === selectedKey
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60 hover:bg-background"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
                onClick={() => setSelectedKey(pageItem.key)}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-tight">{pageItem.title}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {pageItem.repoLabel}/docs/{pageItem.path}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </div>
      </aside>

      <article className="min-w-0 flex-1 overflow-auto bg-background/40 p-6" aria-live="polite">
        {pageLoading ? <DocumentState>{t("kb.loading")}</DocumentState> : null}
        {!pageLoading && pageError ? <DocumentState>{t("kb.errors.loadFailed")}</DocumentState> : null}
        {!pageLoading && !pageError && page ? (
          <Markdown className="mx-auto max-w-3xl text-sm leading-7">{page.body}</Markdown>
        ) : null}
        {!pageLoading && !pageError && !page ? (
          <DocumentState>{t("kb.assistantDocuments.selectPage")}</DocumentState>
        ) : null}
      </article>
    </section>
  );
}

function FilterButton({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      disabled={disabled}
      className="h-7 rounded-md px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function DocumentState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{children}</div>;
}

function normalizeReferenceSet(paths: string[]): Set<string> {
  const normalized = new Set<string>();
  for (const path of paths) {
    const reference = normalizeKbDocumentReference(path);
    if (reference) normalized.add(reference);
  }
  return normalized;
}

function flattenPages(
  nodes: KbTreeNode[],
  repo: { repoSlug: string; repoLabel: string },
): AssistantKbPageItem[] {
  return nodes.flatMap((node) => {
    if (node.type === "page") {
      return [
        {
          key: `${repo.repoSlug}\0${node.path}`,
          repoSlug: repo.repoSlug,
          repoLabel: repo.repoLabel,
          path: node.path,
          title: node.title || node.name,
        },
      ];
    }

    return flattenPages(node.children, repo);
  });
}
