import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { KbAssetPreview } from "@/components/kb/KbAssetPreview";
import { KbEditor } from "@/components/kb/KbEditor";
import { KbSidebar } from "@/components/kb/KbSidebar";
import type { KbDeleteKind, KbTreeHandlers } from "@/components/kb/KbTreeList";
import { Button } from "@/components/ui/button";
import { useKbAllRepoTrees } from "@/hooks/useKbAllRepoTrees";
import { useKbPage } from "@/hooks/useKbPage";
import { useKbProjectOverview } from "@/hooks/useKbProjectOverview";
import { useKbSync } from "@/hooks/useKbSync";
import { normalizeKbDocumentReference } from "@/lib/assistantKbReferences";
import { isKbImageAssetPath, type KbAssetContext } from "@/lib/kbAssets";
import { collectKbImageAssets } from "@/lib/kbGallery";
import {
  createChildPage,
  createFolderPage,
  removePage,
  renamePageTitle,
  reorderPages,
  togglePageFavorite,
} from "@/lib/kbTreeActions";
import { cn } from "@/lib/utils";
import { deleteAsset, deleteFolder, renameAsset, savePage } from "@/services/knowledgeBase";
import type { KbSearchResult, KbTreeNode } from "@/types/knowledgeBase";
import type { KbInlineEdit, KbPageDraft, KbRenameTarget } from "@/types/kbPageDraft";

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
type KbRemoveFn = (projectSlug: string, repoSlug: string, path: string) => Promise<unknown>;

interface KbDeleteConfig {
  remove: KbRemoveFn;
  confirmKey: string;
  successKey: string;
}

export function AssistantKbDocumentsPanel({
  projectSlug,
  citedPaths,
  requestedPath = null,
  className,
}: AssistantKbDocumentsPanelProps) {
  const { t } = useTranslation();
  const { overview, loading: overviewLoading } = useKbProjectOverview(projectSlug);
  const repoSlugs = useMemo(() => overview?.repositories.map((repo) => repo.repoSlug) ?? [], [overview]);
  const { treesByRepo, loading: treesLoading, reloadRepo } = useKbAllRepoTrees(projectSlug, repoSlugs);
  const citedPathSet = useMemo(() => normalizeReferenceSet(citedPaths), [citedPaths]);
  const [filter, setFilter] = useState<KbDocumentFilter>(() => (citedPathSet.size > 0 ? "cited" : "all"));
  const [filterTouched, setFilterTouched] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ repoSlug: string; path: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pageDraft, setPageDraft] = useState<KbPageDraft | null>(null);
  const [renameTarget, setRenameTarget] = useState<KbRenameTarget | null>(null);

  const allPages = useMemo<AssistantKbPageItem[]>(() => {
    if (!overview) return [];

    return overview.repositories.flatMap((repo) =>
      flattenPages(treesByRepo[repo.repoSlug] ?? [], {
        repoSlug: repo.repoSlug,
        repoLabel: repo.workspacePath,
      }),
    );
  }, [overview, treesByRepo]);

  const citedTreesByRepo = useMemo(() => {
    if (!overview) return {};
    return buildCitedTreesByRepo(overview.repositories.map((repo) => repo.repoSlug), treesByRepo, citedPathSet);
  }, [overview, treesByRepo, citedPathSet]);

  const displayedTreesByRepo = filter === "cited" && citedPathSet.size > 0 ? citedTreesByRepo : treesByRepo;

  const visiblePages = useMemo(() => {
    if (!overview) return [];
    return overview.repositories.flatMap((repo) =>
      flattenPages(displayedTreesByRepo[repo.repoSlug] ?? [], {
        repoSlug: repo.repoSlug,
        repoLabel: repo.workspacePath,
      }),
    );
  }, [displayedTreesByRepo, overview]);

  const selectedPage = selectedLocation
    ? visiblePages.find((page) => page.repoSlug === selectedLocation.repoSlug && page.path === selectedLocation.path) ?? null
    : null;
  const isAssetPath = isKbImageAssetPath(selectedPage?.path ?? null);
  const { page, loading: pageLoading, error: pageError, reload: reloadPage } = useKbPage(
    projectSlug,
    selectedPage?.repoSlug ?? null,
    isAssetPath ? null : selectedPage?.path ?? null,
  );
  const { state: syncState, loading: syncLoading, triggerSync } = useKbSync(projectSlug, selectedPage?.repoSlug ?? null);
  const loading = overviewLoading || treesLoading;
  const galleryAssets = useMemo(
    () => collectKbImageAssets(selectedPage ? (treesByRepo[selectedPage.repoSlug] ?? []) : []),
    [selectedPage, treesByRepo],
  );
  const pageFavorite = page?.frontmatter.favorite === true;
  const assetContext = useMemo<KbAssetContext | null>(
    () =>
      selectedPage && !isAssetPath
        ? { projectSlug, repoSlug: selectedPage.repoSlug, pagePath: selectedPage.path }
        : null,
    [isAssetPath, projectSlug, selectedPage],
  );

  useEffect(() => {
    if (citedPathSet.size === 0 && filter === "cited") setFilter("all");
    if (!filterTouched && citedPathSet.size > 0) setFilter("cited");
  }, [citedPathSet, filter, filterTouched]);

  useEffect(() => {
    const normalizedRequestedPath = normalizeKbDocumentReference(requestedPath);
    if (!normalizedRequestedPath) return;

    const requestedPage = allPages.find((candidate) => candidate.path === normalizedRequestedPath);
    if (requestedPage) {
      setSelectedLocation({ repoSlug: requestedPage.repoSlug, path: requestedPage.path });
      if (!citedPathSet.has(requestedPage.path)) setFilter("all");
    }
  }, [allPages, citedPathSet, requestedPath]);

  useEffect(() => {
    setSelectedLocation((current) => {
      if (current && visiblePages.some((pageItem) => pageItem.repoSlug === current.repoSlug && pageItem.path === current.path)) {
        return current;
      }
      const first = visiblePages[0];
      return first ? { repoSlug: first.repoSlug, path: first.path } : null;
    });
  }, [visiblePages]);

  const selectFilter = useCallback((nextFilter: KbDocumentFilter) => {
    setFilterTouched(true);
    setFilter(nextFilter);
  }, []);

  const refreshRepo = useCallback(
    async (repoSlug: string) => {
      await reloadRepo(repoSlug);
    },
    [reloadRepo],
  );

  const handleSave = useCallback(
    async (markdown: string) => {
      if (!selectedPage || !page || isAssetPath) return;
      setSaving(true);
      try {
        await savePage(projectSlug, selectedPage.repoSlug, selectedPage.path, {
          frontmatter: page.frontmatter ?? {},
          body: markdown,
        });
        await reloadPage();
        await refreshRepo(selectedPage.repoSlug);
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [isAssetPath, page, projectSlug, refreshRepo, reloadPage, selectedPage, t],
  );

  const handleSearchSelect = useCallback((result: KbSearchResult) => {
    setFilterTouched(true);
    setFilter("all");
    setSelectedLocation({ repoSlug: result.repoSlug, path: result.path });
  }, []);

  const handleCreatePage = useCallback(
    async (createRepo: string, title: string, parentPath = "", insertAfterPath: string | null = null) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const tree = treesByRepo[createRepo] ?? [];
      try {
        const path = await createChildPage(projectSlug, createRepo, tree, parentPath, trimmed, insertAfterPath);
        await refreshRepo(createRepo);
        setFilterTouched(true);
        setFilter("all");
        setSelectedLocation({ repoSlug: createRepo, path });
        toast.success(t("kb.create.created"));
      } catch {
        toast.error(t("kb.create.failed"));
      }
    },
    [projectSlug, refreshRepo, t, treesByRepo],
  );

  const handleCreateFolder = useCallback(
    async (createRepo: string, name: string, parentPath = "") => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const tree = treesByRepo[createRepo] ?? [];
      try {
        const path = await createFolderPage(projectSlug, createRepo, tree, parentPath, trimmed);
        await refreshRepo(createRepo);
        setFilterTouched(true);
        setFilter("all");
        setSelectedLocation({ repoSlug: createRepo, path });
        toast.success(t("kb.actions.folderCreated"));
      } catch {
        toast.error(t("kb.create.failed"));
      }
    },
    [projectSlug, refreshRepo, t, treesByRepo],
  );

  const handleDraftSubmit = useCallback(
    async (title: string) => {
      if (!pageDraft) return;
      const draft = pageDraft;
      setPageDraft(null);
      if (draft.kind === "folder") {
        await handleCreateFolder(draft.repoSlug, title, draft.parentPath);
        return;
      }
      await handleCreatePage(draft.repoSlug, title, draft.parentPath, draft.insertAfterPath);
    },
    [handleCreateFolder, handleCreatePage, pageDraft],
  );

  const handleRenameSubmit = useCallback(
    async (title: string) => {
      if (!renameTarget) return;
      const target = renameTarget;
      const next = title.trim();
      setRenameTarget(null);
      if (!next || next === target.title) return;

      try {
        if (isKbImageAssetPath(target.path)) {
          const result = await renameAsset(projectSlug, target.repoSlug, target.path, next);
          await refreshRepo(target.repoSlug);
          if (selectedPage?.repoSlug === target.repoSlug && selectedPage.path === target.path) {
            setSelectedLocation({ repoSlug: target.repoSlug, path: result.assetPath });
          }
          toast.success(t("kb.asset.renamed"));
          return;
        }

        await renamePageTitle(projectSlug, target.repoSlug, target.path, next);
        await refreshRepo(target.repoSlug);
        if (selectedPage?.repoSlug === target.repoSlug && selectedPage.path === target.path) await reloadPage();
        toast.success(t("kb.actions.renamed"));
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      }
    },
    [projectSlug, refreshRepo, reloadPage, renameTarget, selectedPage, t],
  );

  const cancelInlineEdit = useCallback(() => {
    setPageDraft(null);
    setRenameTarget(null);
  }, []);

  const treeHandlers = useMemo<KbTreeHandlers>(
    () => ({
      onReorder: (targetRepo, parentPath, activePath, overPath) => {
        const tree = treesByRepo[targetRepo] ?? [];
        void reorderPages(projectSlug, targetRepo, tree, parentPath, activePath, overPath)
          .then(() => refreshRepo(targetRepo))
          .catch(() => toast.error(t("kb.errors.reorderFailed")));
      },
      onRename: (targetRepo, path, currentTitle) => {
        setPageDraft(null);
        setRenameTarget({ repoSlug: targetRepo, path, title: currentTitle });
      },
      onToggleFavorite: (targetRepo, path, favorite) => {
        void togglePageFavorite(projectSlug, targetRepo, path, favorite)
          .then(async () => {
            await refreshRepo(targetRepo);
            if (selectedPage?.repoSlug === targetRepo && selectedPage.path === path) await reloadPage();
          })
          .catch(() => toast.error(t("kb.errors.saveFailed")));
      },
      onDelete: (targetRepo, path, title, kind) => {
        const { remove, confirmKey, successKey } = deleteConfigFor(kind);
        if (!window.confirm(t(confirmKey, { title }))) return;
        void remove(projectSlug, targetRepo, path)
          .then(async () => {
            await refreshRepo(targetRepo);
            if (selectedPage?.repoSlug === targetRepo && selectedPage.path === path) setSelectedLocation(null);
            toast.success(t(successKey));
          })
          .catch(() => toast.error(t("kb.errors.deleteFailed")));
      },
      onCreateFolder: (targetRepo, parentPath) => {
        setRenameTarget(null);
        setPageDraft({ repoSlug: targetRepo, parentPath, insertAfterPath: null, kind: "folder" });
      },
      onStartAddPage: (targetRepo, parentPath, insertAfterPath = null) => {
        setRenameTarget(null);
        setPageDraft({ repoSlug: targetRepo, parentPath, insertAfterPath: insertAfterPath ?? null, kind: "page" });
      },
    }),
    [projectSlug, refreshRepo, reloadPage, selectedPage, t, treesByRepo],
  );

  const inlineEdit = useMemo<KbInlineEdit>(
    () => ({
      draft: pageDraft,
      rename: renameTarget,
      onDraftSubmit: handleDraftSubmit,
      onRenameSubmit: handleRenameSubmit,
      onCancel: cancelInlineEdit,
    }),
    [cancelInlineEdit, handleDraftSubmit, handleRenameSubmit, pageDraft, renameTarget],
  );

  const handlePageRename = useCallback(() => {
    if (!selectedPage || !page) return;
    treeHandlers.onRename(selectedPage.repoSlug, selectedPage.path, page.title);
  }, [page, selectedPage, treeHandlers]);

  const handlePageFavorite = useCallback(() => {
    if (!selectedPage) return;
    treeHandlers.onToggleFavorite(selectedPage.repoSlug, selectedPage.path, pageFavorite);
  }, [pageFavorite, selectedPage, treeHandlers]);

  const handlePageDelete = useCallback(() => {
    if (!selectedPage || !page) return;
    treeHandlers.onDelete(selectedPage.repoSlug, selectedPage.path, page.title, "page");
  }, [page, selectedPage, treeHandlers]);

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
            <FilterButton active={filter === "cited"} disabled={citedPathSet.size === 0} onClick={() => selectFilter("cited")}>
              {t("kb.assistantDocuments.cited")}
            </FilterButton>
            <FilterButton active={filter === "all"} onClick={() => selectFilter("all")}>
              {t("kb.assistantDocuments.all")}
            </FilterButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("kb.loading")}</p> : null}

          {!loading && visiblePages.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {filter === "cited"
                ? t("kb.assistantDocuments.noCitedMatches")
                : t("kb.assistantDocuments.empty")}
            </p>
          ) : null}

          {!loading && overview && visiblePages.length > 0 ? (
            <KbSidebar
              projectSlug={projectSlug}
              overview={overview}
              treesByRepo={displayedTreesByRepo}
              activeRepo={selectedPage?.repoSlug ?? null}
              activePath={selectedPage?.path ?? null}
              onSelectRepo={(repoSlug) => {
                const firstPage = flattenPages(displayedTreesByRepo[repoSlug] ?? [], {
                  repoSlug,
                  repoLabel: overview.repositories.find((repo) => repo.repoSlug === repoSlug)?.workspacePath ?? repoSlug,
                })[0];
                if (firstPage) setSelectedLocation({ repoSlug: firstPage.repoSlug, path: firstPage.path });
              }}
              onSearchSelect={handleSearchSelect}
              treeHandlers={treeHandlers}
              inlineEdit={inlineEdit}
              pageHref={(repoSlug, pagePath) => `#${encodeURIComponent(repoSlug)}/${encodeURIComponent(pagePath)}`}
              onSelectPath={(repoSlug, path) => setSelectedLocation({ repoSlug, path })}
              singleRepo={repoSlugs.length === 1}
            />
          ) : null}
        </div>
      </aside>

      <article className="min-w-0 flex-1 overflow-hidden bg-background/40" aria-live="polite">
        {selectedPage && isAssetPath ? (
          <KbAssetPreview projectSlug={projectSlug} repoSlug={selectedPage.repoSlug} assetPath={selectedPage.path} />
        ) : null}
        {!isAssetPath && pageLoading ? <DocumentState>{t("kb.loading")}</DocumentState> : null}
        {!isAssetPath && !pageLoading && pageError ? <DocumentState>{t("kb.errors.loadFailed")}</DocumentState> : null}
        {!isAssetPath && !pageLoading && !pageError && page && selectedPage ? (
          <KbEditor
            key={`${selectedPage.repoSlug}/${selectedPage.path}`}
            title={page.title}
            markdown={page.body}
            saving={saving}
            favorite={pageFavorite}
            onSave={handleSave}
            onRename={handlePageRename}
            onToggleFavorite={handlePageFavorite}
            onDelete={handlePageDelete}
            assetContext={assetContext}
            assets={galleryAssets}
            syncState={syncState}
            syncLoading={syncLoading}
            onSync={() => void triggerSync()}
          />
        ) : null}
        {!isAssetPath && !pageLoading && !pageError && !page ? (
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
  return <div className="m-6 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">{children}</div>;
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

function buildCitedTreesByRepo(
  repoSlugs: string[],
  treesByRepo: Record<string, KbTreeNode[]>,
  citedPaths: Set<string>,
): Record<string, KbTreeNode[]> {
  const citedTrees = Object.fromEntries(
    repoSlugs.map((repoSlug) => [repoSlug, filterTreeByPaths(treesByRepo[repoSlug] ?? [], citedPaths)]),
  );
  const pathsPresentInTrees = new Set(
    Object.values(treesByRepo).flatMap((tree) => flattenPages(tree, { repoSlug: "", repoLabel: "" }).map((page) => page.path)),
  );

  if (repoSlugs.length === 1) {
    const [repoSlug] = repoSlugs;
    if (repoSlug) {
      for (const path of citedPaths) {
        if (!pathsPresentInTrees.has(path)) {
          citedTrees[repoSlug] = insertSyntheticPage(citedTrees[repoSlug] ?? [], path);
        }
      }
    }
  }

  return citedTrees;
}

function filterTreeByPaths(nodes: KbTreeNode[], paths: Set<string>): KbTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "page" || node.type === "asset") return paths.has(node.path) ? [node] : [];

    const children = filterTreeByPaths(node.children, paths);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

function insertSyntheticPage(nodes: KbTreeNode[], path: string): KbTreeNode[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return nodes;

  return insertSyntheticNode(nodes, segments, "");
}

function insertSyntheticNode(nodes: KbTreeNode[], segments: string[], parentPath: string): KbTreeNode[] {
  const [segment, ...rest] = segments;
  if (!segment) return nodes;
  const currentPath = parentPath ? `${parentPath}/${segment}` : segment;

  if (rest.length === 0) {
    if (nodes.some((node) => node.path === currentPath)) return nodes;
    return [
      ...nodes,
      {
        type: "page",
        name: segment,
        path: currentPath,
        title: titleFromFilename(segment),
        order: null,
        favorite: false,
        children: [],
      },
    ];
  }

  const existingIndex = nodes.findIndex((node) => node.type === "folder" && node.path === currentPath);
  if (existingIndex >= 0) {
    return nodes.map((node, index) =>
      index === existingIndex ? { ...node, children: insertSyntheticNode(node.children, rest, currentPath) } : node,
    );
  }

  return [
    ...nodes,
    {
      type: "folder",
      name: segment,
      path: currentPath,
      title: titleFromFilename(segment),
      order: null,
      favorite: false,
      children: insertSyntheticNode([], rest, currentPath),
    },
  ];
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function deleteConfigFor(kind: KbDeleteKind): KbDeleteConfig {
  switch (kind) {
    case "folder":
      return { remove: deleteFolder, confirmKey: "kb.folder.deleteConfirm", successKey: "kb.folder.deleted" };
    case "asset":
      return { remove: deleteAsset, confirmKey: "kb.asset.deleteConfirm", successKey: "kb.asset.deleted" };
    default:
      return { remove: removePage, confirmKey: "kb.actions.deleteConfirm", successKey: "kb.actions.deleted" };
  }
}
