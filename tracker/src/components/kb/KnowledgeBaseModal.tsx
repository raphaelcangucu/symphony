import { PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { ComposerContextChipRef } from "@/components/assistant/contextMentions";
import { KbAssetPreview } from "@/components/kb/KbAssetPreview";
import { KbEditor } from "@/components/kb/KbEditor";
import { KbSidebar } from "@/components/kb/KbSidebar";
import type { KbDeleteKind, KbTreeHandlers } from "@/components/kb/KbTreeList";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useKbAllRepoTrees } from "@/hooks/useKbAllRepoTrees";
import { useKbPage } from "@/hooks/useKbPage";
import { isKbImageAssetPath } from "@/lib/kbAssets";
import { kbPagePath as buildKbPagePath } from "@/lib/kbRoutes";
import {
  createChildPage,
  createFolderPage,
  removePage,
  renamePageTitle,
  reorderPages,
  togglePageFavorite,
} from "@/lib/kbTreeActions";
import { withSyntheticChangedPages } from "@/lib/kbTreeFilter";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import { deleteAsset, deleteFolder, getPage, getProjectOverview, renameAsset, savePage } from "@/services/knowledgeBase";
import type { KbInlineEdit, KbPageDraft, KbRenameTarget } from "@/types/kbPageDraft";
import type { KbPage, KbProjectOverview, KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";

type KbModalDocumentFilter = "changed" | "all";

interface KnowledgeBaseModalProps {
  open: boolean;
  projectSlug: string;
  onOpenChange: (open: boolean) => void;
  onInsertContext?: (ref: ComposerContextChipRef) => void;
  /** When set, enables Alterados/Todos filtering for the issue working tree. */
  issueIdentifier?: string | null;
  /** Docs-relative paths from the issue uncommitted diff (already stripped of `docs/`). */
  changedDocPaths?: string[];
}

export function KnowledgeBaseModal({
  open,
  projectSlug,
  onOpenChange,
  onInsertContext,
  issueIdentifier = null,
  changedDocPaths = [],
}: KnowledgeBaseModalProps) {
  const { t } = useTranslation();
  const issueMode = Boolean(issueIdentifier);
  const [overview, setOverview] = useState<KbProjectOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageDraft, setPageDraft] = useState<KbPageDraft | null>(null);
  const [renameTarget, setRenameTarget] = useState<KbRenameTarget | null>(null);
  const [filter, setFilter] = useState<KbModalDocumentFilter>(() =>
    issueMode && changedDocPaths.length > 0 ? "changed" : "all",
  );
  const repoSlugs = useMemo(() => overview?.repositories.map((repo) => repo.repoSlug) ?? [], [overview]);
  const { treesByRepo, reloadRepo } = useKbAllRepoTrees(open ? projectSlug : "", repoSlugs);
  const changedPathSet = useMemo(() => new Set(changedDocPaths.filter(Boolean)), [changedDocPaths]);
  const displayedTreesByRepo = useMemo(() => {
    if (!issueMode || filter !== "changed" || changedPathSet.size === 0) return treesByRepo;
    return withSyntheticChangedPages(treesByRepo, repoSlugs, changedPathSet);
  }, [changedPathSet, filter, issueMode, repoSlugs, treesByRepo]);
  const selectedIsAsset = isKbImageAssetPath(activePath);
  const { page: selectedPage, loading: selectedPageLoading, error: selectedPageError, reload: reloadSelectedPage } = useKbPage(
    projectSlug,
    activeRepo,
    activePath && !selectedIsAsset ? activePath : null,
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoadError(null);

    async function loadOverview() {
      try {
        const nextOverview = await getProjectOverview(projectSlug);
        if (!cancelled) setOverview(nextOverview);
      } catch (cause) {
        if (cancelled) return;
        setOverview(null);
        setLoadError(cause instanceof Error ? cause.message : t("assistant.panel.knowledgeBaseLoadFailed"));
      }
    }

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [open, projectSlug, t]);

  useEffect(() => {
    if (!overview) return;
    setActiveRepo((current) => current ?? overview.repositories[0]?.repoSlug ?? null);
  }, [overview]);

  useEffect(() => {
    if (!open) return;
    setFilter(issueMode && changedPathSet.size > 0 ? "changed" : "all");
  }, [changedPathSet.size, issueMode, open, issueIdentifier]);

  useEffect(() => {
    if (issueMode && filter === "changed" && changedPathSet.size === 0) {
      setFilter("all");
    }
  }, [changedPathSet.size, filter, issueMode]);

  const pageHref = useCallback((repoSlug: string, pagePath: string) => buildKbPagePath(projectSlug, repoSlug, pagePath), [projectSlug]);
  const handleSelectRepo = useCallback((repoSlug: string) => {
    setActiveRepo(repoSlug);
    setActivePath(null);
    setTreeCollapsed(false);
  }, []);
  const handleSelectPath = useCallback((repoSlug: string, pagePath: string) => {
    setActiveRepo(repoSlug);
    setActivePath(pagePath);
    setTreeCollapsed(true);
  }, []);
  const refreshRepo = useCallback(async (repoSlug: string) => {
    await reloadRepo(repoSlug);
  }, [reloadRepo]);

  const handleSavePage = useCallback(
    async (markdown: string) => {
      if (!activeRepo || !activePath || !selectedPage) return;
      setSaving(true);
      try {
        await savePage(projectSlug, activeRepo, activePath, {
          frontmatter: selectedPage.frontmatter ?? {},
          body: markdown,
        });
        await reloadSelectedPage();
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [activePath, activeRepo, projectSlug, reloadSelectedPage, selectedPage, t],
  );

  const handleCreatePage = useCallback(
    async (repoSlug: string, title: string, parentPath = "", insertAfterPath: string | null = null) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const tree = treesByRepo[repoSlug] ?? [];
      try {
        const path = await createChildPage(projectSlug, repoSlug, tree, parentPath, trimmed, insertAfterPath);
        await refreshRepo(repoSlug);
        setActiveRepo(repoSlug);
        setActivePath(path);
        setTreeCollapsed(true);
        toast.success(t("kb.create.created"));
      } catch {
        toast.error(t("kb.create.failed"));
      }
    },
    [projectSlug, refreshRepo, t, treesByRepo],
  );

  const handleCreateFolder = useCallback(
    async (repoSlug: string, name: string, parentPath = "") => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const tree = treesByRepo[repoSlug] ?? [];
      try {
        const path = await createFolderPage(projectSlug, repoSlug, tree, parentPath, trimmed);
        await refreshRepo(repoSlug);
        setActiveRepo(repoSlug);
        setActivePath(path);
        setTreeCollapsed(true);
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

      if (isKbImageAssetPath(target.path)) {
        try {
          const result = await renameAsset(projectSlug, target.repoSlug, target.path, next);
          await refreshRepo(target.repoSlug);
          if (activeRepo === target.repoSlug && activePath === target.path) setActivePath(result.assetPath);
          toast.success(t("kb.asset.renamed"));
        } catch {
          toast.error(t("kb.errors.saveFailed"));
        }
        return;
      }

      try {
        await renamePageTitle(projectSlug, target.repoSlug, target.path, next);
        await refreshRepo(target.repoSlug);
        if (activeRepo === target.repoSlug && activePath === target.path) await reloadSelectedPage();
        toast.success(t("kb.actions.renamed"));
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      }
    },
    [activePath, activeRepo, projectSlug, refreshRepo, reloadSelectedPage, renameTarget, t],
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
            if (activeRepo === targetRepo && activePath === path) await reloadSelectedPage();
          })
          .catch(() => toast.error(t("kb.errors.saveFailed")));
      },
      onDelete: (targetRepo, path, title, kind) => {
        const remove = deleteKbNodeFor(kind);
        if (!window.confirm(t(deleteConfirmKeyFor(kind), { title }))) return;
        void remove(projectSlug, targetRepo, path)
          .then(async () => {
            await refreshRepo(targetRepo);
            if (activeRepo === targetRepo && activePath === path) {
              setActivePath(null);
              setTreeCollapsed(false);
            }
            toast.success(t(deleteSuccessKeyFor(kind)));
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
    [activePath, activeRepo, projectSlug, refreshRepo, reloadSelectedPage, t, treesByRepo],
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

  const pageFavorite = selectedPage?.frontmatter.favorite === true;
  const handlePageRename = useCallback(() => {
    if (!activeRepo || !activePath || !selectedPage) return;
    treeHandlers.onRename(activeRepo, activePath, selectedPage.title);
    setTreeCollapsed(false);
  }, [activePath, activeRepo, selectedPage, treeHandlers]);
  const handlePageFavorite = useCallback(() => {
    if (!activeRepo || !activePath) return;
    treeHandlers.onToggleFavorite(activeRepo, activePath, pageFavorite);
  }, [activePath, activeRepo, pageFavorite, treeHandlers]);
  const handlePageDelete = useCallback(() => {
    if (!activeRepo || !activePath || !selectedPage) return;
    treeHandlers.onDelete(activeRepo, activePath, selectedPage.title, "page");
  }, [activePath, activeRepo, selectedPage, treeHandlers]);

  const handleInsertContext = useCallback(
    async (repoSlug: string, node: KbTreeNodeType) => {
      if (!onInsertContext) return;
      const title = node.title || node.name || node.path;
      const detail = `KB ${repoSlug}`;
      if (node.type === "page") {
        const page = activeRepo === repoSlug && activePath === node.path && selectedPage
          ? selectedPage
          : await getPage(projectSlug, repoSlug, node.path);
        onInsertContext({
          type: "doc",
          id: `kb:${repoSlug}:${node.path}`,
          label: page.title || title,
          detail,
          content: [`### KB document: ${page.title || title}`, "", `- Repository: ${repoSlug}`, `- Path: ${node.path}`, "", page.body].join("\n"),
          state: "draft",
        });
        return;
      }

      onInsertContext({
        type: "doc",
        id: `kb:${repoSlug}:${node.path}`,
        label: title,
        detail,
        content: ["### KB asset", "", `- Repository: ${repoSlug}`, `- Path: ${node.path}`].join("\n"),
        state: "draft",
      });
    },
    [activePath, activeRepo, onInsertContext, projectSlug, selectedPage],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,900px)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{t("assistant.panel.knowledgeBaseTitle")}</DialogTitle>
          <DialogDescription>
            {issueMode
              ? t("kb.assistantDocuments.changedSubtitle", { count: changedPathSet.size })
              : t("assistant.panel.knowledgeBaseDescription", { slug: projectSlug })}
          </DialogDescription>
          {issueMode ? (
            <div className="mt-3 grid max-w-xs grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
              <FilterButton
                active={filter === "changed"}
                disabled={changedPathSet.size === 0}
                onClick={() => setFilter("changed")}
              >
                {t("kb.assistantDocuments.changed")}
              </FilterButton>
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
                {t("kb.assistantDocuments.all")}
              </FilterButton>
            </div>
          ) : null}
        </DialogHeader>
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1",
            treeCollapsed ? "md:grid-cols-1" : "md:grid-cols-[minmax(18rem,24rem)_1fr]",
          )}
        >
          {loadError ? (
            <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive md:col-span-2">
              {loadError}
            </div>
          ) : null}
          {!overview && !loadError ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground md:col-span-2">
              {t("common.loading")}
            </div>
          ) : null}
          {overview ? (
            overview.repositories.length === 0 ? (
              <div className="m-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground md:col-span-2">
                {t("assistant.panel.knowledgeBaseEmpty")}
              </div>
            ) : (
              <>
                {treeCollapsed ? null : (
                  <aside className="min-h-0 border-r">
                    <KbSidebar
                      projectSlug={projectSlug}
                      overview={overview}
                      treesByRepo={displayedTreesByRepo}
                      activeRepo={activeRepo}
                      activePath={activePath}
                      onSelectRepo={handleSelectRepo}
                      onSearchSelect={(result) => handleSelectPath(result.repoSlug, result.path)}
                      treeHandlers={treeHandlers}
                      inlineEdit={inlineEdit}
                      pageHref={pageHref}
                      onSelectPath={handleSelectPath}
                      onInsertContext={
                        onInsertContext
                          ? (repoSlug, node) => {
                              void handleInsertContext(repoSlug, node);
                            }
                          : undefined
                      }
                    />
                  </aside>
                )}
                <KnowledgeBaseModalPreview
                  projectSlug={projectSlug}
                  repoSlug={activeRepo}
                  pagePath={activePath}
                  page={selectedPage}
                  loading={selectedPageLoading}
                  error={selectedPageError}
                  isAsset={selectedIsAsset}
                  saving={saving}
                  treeCollapsed={treeCollapsed}
                  onSave={handleSavePage}
                  onRename={selectedPage ? handlePageRename : undefined}
                  onToggleFavorite={selectedPage ? handlePageFavorite : undefined}
                  onDelete={selectedPage ? handlePageDelete : undefined}
                  onShowTree={() => setTreeCollapsed(false)}
                />
              </>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KnowledgeBaseModalPreview({
  projectSlug,
  repoSlug,
  pagePath,
  page,
  loading,
  error,
  isAsset,
  saving,
  treeCollapsed,
  onSave,
  onRename,
  onToggleFavorite,
  onDelete,
  onShowTree,
}: {
  projectSlug: string;
  repoSlug: string | null;
  pagePath: string | null;
  page: KbPage | null;
  loading: boolean;
  error: Error | null;
  isAsset: boolean;
  saving: boolean;
  treeCollapsed: boolean;
  onSave: (markdown: string) => Promise<void> | void;
  onRename?: () => void;
  onToggleFavorite?: () => void;
  onDelete?: () => void;
  onShowTree: () => void;
}) {
  const { t } = useTranslation();

  if (!repoSlug || !pagePath) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center text-sm text-muted-foreground">
          {t("assistant.panel.knowledgeBaseSelectPage")}
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex min-w-0 items-center gap-2 border-b px-4 py-2">
        {treeCollapsed ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onShowTree}>
            <PanelLeftOpen className="h-3.5 w-3.5" />
            {t("assistant.panel.knowledgeBaseShowTree")}
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={pagePath}>
            {page?.title ?? pagePath}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {repoSlug} / {pagePath}
          </p>
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", SCROLLBAR_THIN)}>
        {isAsset ? (
          <KbAssetPreview projectSlug={projectSlug} repoSlug={repoSlug} assetPath={pagePath} />
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error.message || t("kb.errors.loadFailed")}
          </div>
        ) : page ? (
          <KbEditor
            key={`${repoSlug}/${pagePath}`}
            title={page.title}
            markdown={page.body}
            saving={saving}
            favorite={page.frontmatter.favorite === true}
            onSave={onSave}
            onRename={onRename}
            onToggleFavorite={onToggleFavorite}
            onDelete={onDelete}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("kb.empty.selectPage")}
          </div>
        )}
      </div>
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

function deleteKbNodeFor(kind: KbDeleteKind) {
  if (kind === "folder") return deleteFolder;
  if (kind === "asset") return deleteAsset;
  return removePage;
}

function deleteConfirmKeyFor(kind: KbDeleteKind): string {
  if (kind === "folder") return "kb.folder.deleteConfirm";
  if (kind === "asset") return "kb.asset.deleteConfirm";
  return "kb.actions.deleteConfirm";
}

function deleteSuccessKeyFor(kind: KbDeleteKind): string {
  if (kind === "folder") return "kb.folder.deleted";
  if (kind === "asset") return "kb.asset.deleted";
  return "kb.actions.deleted";
}
