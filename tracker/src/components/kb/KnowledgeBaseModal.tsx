import { isAxiosError } from "axios";
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
import { normalizeKbDocumentReference } from "@/lib/assistantKbReferences";
import { isKbImageAssetPath } from "@/lib/kbAssets";
import { buildKbGitHubFileUrl } from "@/lib/kbGitHubUrl";
import { kbPagePath as buildKbPagePath } from "@/lib/kbRoutes";
import {
  createChildPage,
  createFolderPage,
  removePage,
  renamePageTitle,
  reorderPages,
  togglePageFavorite,
} from "@/lib/kbTreeActions";
import { augmentTreesWithChangedPages, withSyntheticChangedPages } from "@/lib/kbTreeFilter";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import {
  deleteAsset,
  deleteFolder,
  getIssuePage,
  getPage,
  getProjectOverview,
  getRepoTree,
  renameAsset,
  saveIssuePage,
  savePage,
} from "@/services/knowledgeBase";
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
  /** Docs-relative paths changed in the issue worktree (already stripped of `docs/`). */
  changedDocPaths?: string[];
  /** Preferred: repo-associated changed docs for multi-repo synthetic insertion. */
  changedDocEntries?: Array<{ repo: string; path: string }>;
  /** Docs-relative or `docs/...` path to select when the modal opens. */
  initialPath?: string | null;
  /** Optional repo slug for `initialPath` when the path exists in multiple repos. */
  initialRepo?: string | null;
}

export function KnowledgeBaseModal({
  open,
  projectSlug,
  onOpenChange,
  onInsertContext,
  issueIdentifier = null,
  changedDocPaths = [],
  changedDocEntries,
  initialPath = null,
  initialRepo = null,
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
  const effectiveEntries = useMemo(() => {
    if (changedDocEntries && changedDocEntries.length > 0) return changedDocEntries;
    return changedDocPaths.filter(Boolean).map((path) => ({ repo: "", path }));
  }, [changedDocEntries, changedDocPaths]);
  const [filter, setFilter] = useState<KbModalDocumentFilter>(() =>
    issueMode && effectiveEntries.length > 0 ? "changed" : "all",
  );
  const repoSlugs = useMemo(() => overview?.repositories.map((repo) => repo.repoSlug) ?? [], [overview]);
  // Always list the project KB tree. Issue trees only contain git-changed docs, so
  // using them here emptied "Todas as docs" when the task had no doc edits yet.
  const { treesByRepo, reloadRepo } = useKbAllRepoTrees(open ? projectSlug : "", repoSlugs, getRepoTree);
  const changedPathSet = useMemo(() => new Set(effectiveEntries.map((entry) => entry.path)), [effectiveEntries]);
  const displayedTreesByRepo = useMemo(() => {
    if (!issueMode || effectiveEntries.length === 0) return treesByRepo;
    if (filter === "changed") {
      return withSyntheticChangedPages(treesByRepo, repoSlugs, effectiveEntries);
    }
    // "Todas as docs" shows the project tree and also surfaces branch-only docs
    // (e.g. superpowers/) that exist in the issue worktree but not on base.
    return augmentTreesWithChangedPages(treesByRepo, repoSlugs, effectiveEntries);
  }, [effectiveEntries, filter, issueMode, repoSlugs, treesByRepo]);
  const selectedIsAsset = isKbImageAssetPath(activePath);
  const loadPage = useCallback(
    async (scopeProjectSlug: string, repoSlug: string, path: string) => {
      if (!issueIdentifier) return getPage(scopeProjectSlug, repoSlug, path);

      const isNotFound = (error: unknown) => isAxiosError(error) && error.response?.status === 404;

      try {
        return await getIssuePage(scopeProjectSlug, issueIdentifier, repoSlug, path);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }

      // Wrong repo slug is a common CreatePlan miss — try sibling issue repos.
      for (const otherRepo of repoSlugs) {
        if (otherRepo === repoSlug) continue;
        try {
          return await getIssuePage(scopeProjectSlug, issueIdentifier, otherRepo, path);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }

      // Last resort: project KB clone (file may already be on the default branch).
      return getPage(scopeProjectSlug, repoSlug, path);
    },
    [issueIdentifier, repoSlugs],
  );
  const { page: selectedPage, loading: selectedPageLoading, error: selectedPageError, reload: reloadSelectedPage } = useKbPage(
    projectSlug,
    activeRepo,
    activePath && !selectedIsAsset ? activePath : null,
    loadPage,
  );

  // Sibling-repo fallback in loadPage may resolve a different repo than activeRepo.
  useEffect(() => {
    const resolvedRepo = selectedPage?.repoSlug;
    if (!resolvedRepo || !activePath) return;
    if (resolvedRepo === activeRepo) return;
    setActiveRepo(resolvedRepo);
  }, [activePath, activeRepo, selectedPage?.repoSlug]);
  const activeRepository = useMemo(
    () => overview?.repositories.find((repo) => repo.repoSlug === activeRepo) ?? null,
    [activeRepo, overview],
  );
  const githubFileUrl = useMemo(
    () =>
      activePath && !selectedIsAsset
        ? buildKbGitHubFileUrl(
            activeRepository?.githubFullName,
            activePath,
            activeRepository?.defaultBranch,
          )
        : null,
    [activePath, activeRepository, selectedIsAsset],
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

    const normalizedPath = normalizeKbDocumentReference(initialPath) ?? initialPath?.trim() ?? null;
    if (!normalizedPath) return;

    if (initialRepo) {
      setActiveRepo(initialRepo);
      setActivePath(normalizedPath);
      setTreeCollapsed(true);
      setFilter("all");
      return;
    }

    for (const repoSlug of repoSlugs) {
      if (treeContainsPage(treesByRepo[repoSlug] ?? [], normalizedPath)) {
        setActiveRepo(repoSlug);
        setActivePath(normalizedPath);
        setTreeCollapsed(true);
        setFilter("all");
        return;
      }
    }

    setActivePath(normalizedPath);
    setTreeCollapsed(true);
    setFilter("all");
  }, [initialPath, initialRepo, open, repoSlugs, treesByRepo]);

  useEffect(() => {
    if (!open) return;
    if (initialPath) return;
    setFilter(issueMode && effectiveEntries.length > 0 ? "changed" : "all");
  }, [effectiveEntries.length, initialPath, issueMode, open, issueIdentifier]);

  useEffect(() => {
    if (issueMode && filter === "changed" && effectiveEntries.length === 0) {
      setFilter("all");
    }
  }, [effectiveEntries.length, filter, issueMode]);

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
        const payload = {
          frontmatter: selectedPage.frontmatter ?? {},
          body: markdown,
        };
        if (issueIdentifier) {
          await saveIssuePage(projectSlug, issueIdentifier, activeRepo, activePath, payload);
        } else {
          await savePage(projectSlug, activeRepo, activePath, payload);
        }
        await reloadSelectedPage();
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [activePath, activeRepo, issueIdentifier, projectSlug, reloadSelectedPage, selectedPage, t],
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
        const page =
          activeRepo === repoSlug && activePath === node.path && selectedPage
            ? selectedPage
            : issueIdentifier
              ? await getIssuePage(projectSlug, issueIdentifier, repoSlug, node.path)
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
    [activePath, activeRepo, issueIdentifier, onInsertContext, projectSlug, selectedPage],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,900px)] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-1">
              <DialogTitle>{t("assistant.panel.knowledgeBaseTitle")}</DialogTitle>
              <DialogDescription>
                {issueMode
                  ? t("kb.assistantDocuments.changedSubtitle", { count: effectiveEntries.length })
                  : t("assistant.panel.knowledgeBaseDescription", { slug: projectSlug })}
              </DialogDescription>
            </div>
            {issueMode ? (
              <div
                role="tablist"
                aria-label={t("kb.assistantDocuments.title")}
                className="flex shrink-0 items-center gap-0.5 self-end"
              >
                <FilterTab
                  active={filter === "changed"}
                  disabled={effectiveEntries.length === 0}
                  onClick={() => setFilter("changed")}
                >
                  {t("kb.assistantDocuments.changed")}
                </FilterTab>
                <span aria-hidden className="px-0.5 text-[11px] text-muted-foreground/50">
                  ·
                </span>
                <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
                  {t("kb.assistantDocuments.all")}
                </FilterTab>
              </div>
            ) : null}
          </div>
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
                  githubFileUrl={githubFileUrl}
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
  githubFileUrl = null,
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
  githubFileUrl?: string | null;
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onShowTree}
            aria-label={t("assistant.panel.knowledgeBaseShowTree")}
            title={t("assistant.panel.knowledgeBaseShowTree")}
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
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
            githubFileUrl={githubFileUrl}
            pagePath={pagePath}
            frontmatter={page.frontmatter}
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

function FilterTab({
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
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        active
          ? "text-foreground underline decoration-foreground/35 decoration-1 underline-offset-[5px]"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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

function treeContainsPage(nodes: KbTreeNodeType[], pagePath: string): boolean {
  for (const node of nodes) {
    if (node.type === "page" && node.path === pagePath) return true;
    if (node.children.length > 0 && treeContainsPage(node.children, pagePath)) return true;
  }
  return false;
}
