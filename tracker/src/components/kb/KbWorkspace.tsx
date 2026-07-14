import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { KbAssetPreview } from "@/components/kb/KbAssetPreview";
import { KbAssistantLauncher } from "@/components/kb/KbAssistantLauncher";
import { KbAssistantPanel, type KbLivePageContext } from "@/components/kb/KbAssistantPanel";
import { KbCreatePageForm } from "@/components/kb/KbCreatePageForm";
import { KbEditor, type KbEditorLiveContext } from "@/components/kb/KbEditor";
import { KbSidebar } from "@/components/kb/KbSidebar";
import type { KbDeleteKind, KbTreeHandlers } from "@/components/kb/KbTreeList";
import { useKbAllRepoTrees } from "@/hooks/useKbAllRepoTrees";
import { useKbPage } from "@/hooks/useKbPage";
import { useKbProjectOverview } from "@/hooks/useKbProjectOverview";
import { useKbSync } from "@/hooks/useKbSync";
import {
  createChildPage,
  createFolderPage,
  removePage,
  renamePageTitle,
  reorderPages,
  togglePageFavorite,
} from "@/lib/kbTreeActions";
import { isKbImageAssetPath, type KbAssetContext } from "@/lib/kbAssets";
import { collectKbImageAssets } from "@/lib/kbGallery";
import { buildKbGitHubFileUrl } from "@/lib/kbGitHubUrl";
import { deleteAsset, deleteFolder, renameAsset, savePage } from "@/services/knowledgeBase";
import type { KbSearchResult, KbTreeNode } from "@/types/knowledgeBase";
import type { KbInlineEdit, KbPageDraft, KbRenameTarget } from "@/types/kbPageDraft";

/**
 * Maps KB locations to router URLs so the workspace can be mounted both as a
 * project KB (`/projects/:slug/kb/...`) and the personal KB (`/kb/...`).
 */
export interface KbWorkspaceRouter {
  /** URL for a page within a repository. */
  page: (repoSlug: string, pagePath: string) => string;
  /** URL for a repository root (no page selected). */
  repo: (repoSlug: string) => string;
}

interface KbWorkspaceProps {
  /** Scope slug: a real project slug, or the `@user` personal-KB scope. */
  projectSlug: string;
  /** Active repository slug, or null when none is selected. */
  repoSlug: string | null;
  /** Active page path within the repo, or null when none is selected. */
  pagePath: string | null;
  router: KbWorkspaceRouter;
  /**
   * Preferred landing page when a repo is active but no page is selected.
   * Falls back to the first page in the tree when missing.
   */
  defaultPagePath?: string;
  /** Hides the repository header row when the scope has a single implicit repo. */
  singleRepo?: boolean;
}

function firstPagePath(nodes: KbTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "page") return node.path;
    const child = firstPagePath(node.children);
    if (child) return child;
  }
  return null;
}

function treeHasPage(nodes: KbTreeNode[], path: string): boolean {
  return nodes.some((node) =>
    node.type === "page" ? node.path === path : treeHasPage(node.children, path),
  );
}

type KbRemoveFn = (projectSlug: string, repoSlug: string, path: string) => Promise<unknown>;

interface KbDeleteConfig {
  remove: KbRemoveFn;
  confirmKey: string;
  successKey: string;
}

/** Resolves the delete service + confirmation/success copy for each node kind. */
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

/**
 * The full Notion-style knowledge base workspace: a searchable, editable tree
 * sidebar, the page editor with document actions, and the docked maestro
 * assistant. Both the project KB and the personal KB render this component so
 * they share one implementation and stay in sync.
 */
export function KbWorkspace({
  projectSlug,
  repoSlug,
  pagePath,
  router,
  defaultPagePath,
  singleRepo = false,
}: KbWorkspaceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAssetPath = isKbImageAssetPath(pagePath);

  const { overview } = useKbProjectOverview(projectSlug);
  const repoSlugs = useMemo(() => overview?.repositories.map((repo) => repo.repoSlug) ?? [], [overview]);
  const { treesByRepo, reloadRepo } = useKbAllRepoTrees(projectSlug, repoSlugs);
  const { page, loading: pageLoading, reload: reloadPage } = useKbPage(
    projectSlug,
    repoSlug,
    isAssetPath ? null : pagePath,
  );
  const { state: syncState, loading: syncLoading, triggerSync } = useKbSync(projectSlug, repoSlug);

  // Stable across renders so the editor's content-load effect does not re-run
  // (and reset in-progress edits) every time this page re-renders.
  const assetContext = useMemo<KbAssetContext | null>(
    () => (repoSlug && pagePath ? { projectSlug, repoSlug, pagePath } : null),
    [projectSlug, repoSlug, pagePath],
  );
  const [saving, setSaving] = useState(false);
  const [pageDraft, setPageDraft] = useState<KbPageDraft | null>(null);
  const [renameTarget, setRenameTarget] = useState<KbRenameTarget | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantRunning, setAssistantRunning] = useState(false);

  // The editor registers a lazy getter for its live snapshot (body + selection);
  // the assistant reads it at send time so it always sees the current document.
  const kbContextGetterRef = useRef<() => KbEditorLiveContext>(() => ({ body: "", selection: "" }));

  const handleRegisterContext = useCallback((getter: () => KbEditorLiveContext) => {
    kbContextGetterRef.current = getter;
  }, []);

  const getKbContext = useCallback<() => KbLivePageContext>(() => kbContextGetterRef.current(), []);

  const toggleAssistant = useCallback(() => setAssistantOpen((open) => !open), []);
  const handleRunningChange = useCallback((running: boolean) => setAssistantRunning(running), []);

  const handleAssistantDocChanged = useCallback(() => {
    void reloadPage();
  }, [reloadPage]);

  // Reset the getter to a body-only fallback when navigating pages until the
  // remounted editor re-registers, so the assistant never serves a stale snapshot.
  useEffect(() => {
    kbContextGetterRef.current = () => ({ body: page?.body ?? "", selection: "" });
  }, [repoSlug, pagePath, page?.body]);

  // The page binds the chat to a single (repo, path); drop a stale running pill
  // when navigating to another document.
  useEffect(() => {
    setAssistantRunning(false);
  }, [repoSlug, pagePath]);

  const activeTree = useMemo(
    () => (repoSlug ? (treesByRepo[repoSlug] ?? []) : []),
    [repoSlug, treesByRepo],
  );
  const activeRepository = useMemo(
    () => overview?.repositories.find((repo) => repo.repoSlug === repoSlug) ?? null,
    [overview, repoSlug],
  );
  const githubFileUrl = useMemo(
    () =>
      pagePath && !isAssetPath
        ? buildKbGitHubFileUrl(
            activeRepository?.githubFullName,
            pagePath,
            activeRepository?.defaultBranch,
          )
        : null,
    [activeRepository, pagePath, isAssetPath],
  );
  const galleryAssets = useMemo(() => collectKbImageAssets(activeTree), [activeTree]);

  useEffect(() => {
    if (!repoSlug || pagePath || !activeTree.length) return;
    const preferred =
      defaultPagePath && treeHasPage(activeTree, defaultPagePath) ? defaultPagePath : firstPagePath(activeTree);
    if (preferred) navigate(router.page(repoSlug, preferred), { replace: true });
  }, [repoSlug, pagePath, activeTree, defaultPagePath, navigate, router]);

  const refreshRepo = useCallback(
    async (slug: string) => {
      await reloadRepo(slug);
    },
    [reloadRepo],
  );

  const handleSave = useCallback(
    async (markdown: string) => {
      if (!repoSlug || !pagePath) return;
      setSaving(true);
      try {
        await savePage(projectSlug, repoSlug, pagePath, {
          frontmatter: page?.frontmatter ?? {},
          body: markdown,
        });
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [projectSlug, repoSlug, pagePath, page, t],
  );

  const handleSearchSelect = useCallback(
    (result: KbSearchResult) => {
      navigate(router.page(result.repoSlug, result.path));
    },
    [navigate, router],
  );

  const handleCreatePage = useCallback(
    async (
      createRepo: string,
      title: string,
      parentPath = "",
      insertAfterPath: string | null = null,
    ) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const tree = treesByRepo[createRepo] ?? [];
      try {
        const path = await createChildPage(
          projectSlug,
          createRepo,
          tree,
          parentPath,
          trimmed,
          insertAfterPath,
        );
        await refreshRepo(createRepo);
        navigate(router.page(createRepo, path));
        toast.success(t("kb.create.created"));
      } catch {
        toast.error(t("kb.create.failed"));
      }
    },
    [projectSlug, treesByRepo, refreshRepo, navigate, router, t],
  );

  const handleCreateFolder = useCallback(
    async (createRepo: string, name: string, parentPath = "") => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const tree = treesByRepo[createRepo] ?? [];
      try {
        const path = await createFolderPage(projectSlug, createRepo, tree, parentPath, trimmed);
        await refreshRepo(createRepo);
        navigate(router.page(createRepo, path));
        toast.success(t("kb.actions.folderCreated"));
      } catch {
        toast.error(t("kb.create.failed"));
      }
    },
    [projectSlug, treesByRepo, refreshRepo, navigate, router, t],
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
    [pageDraft, handleCreatePage, handleCreateFolder],
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
          if (repoSlug === target.repoSlug && pagePath === target.path) {
            navigate(router.page(target.repoSlug, result.assetPath), { replace: true });
          } else if (repoSlug === target.repoSlug && pagePath) {
            await reloadPage();
          }
          toast.success(t("kb.asset.renamed"));
        } catch {
          toast.error(t("kb.errors.saveFailed"));
        }
        return;
      }

      try {
        await renamePageTitle(projectSlug, target.repoSlug, target.path, next);
        await refreshRepo(target.repoSlug);
        if (repoSlug === target.repoSlug && pagePath === target.path) await reloadPage();
        toast.success(t("kb.actions.renamed"));
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      }
    },
    [renameTarget, projectSlug, refreshRepo, repoSlug, pagePath, reloadPage, navigate, router, t],
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
            if (repoSlug === targetRepo && pagePath === path) await reloadPage();
          })
          .catch(() => toast.error(t("kb.errors.saveFailed")));
      },
      onDelete: (targetRepo, path, title, kind) => {
        const { remove, confirmKey, successKey } = deleteConfigFor(kind);
        if (!window.confirm(t(confirmKey, { title }))) return;
        void remove(projectSlug, targetRepo, path)
          .then(async () => {
            await refreshRepo(targetRepo);
            if (repoSlug === targetRepo && pagePath === path) navigate(router.repo(targetRepo));
            toast.success(t(successKey));
          })
          .catch(() => toast.error(t("kb.errors.deleteFailed")));
      },
      onCreateFolder: (targetRepo, parentPath) => {
        setRenameTarget(null);
        setPageDraft({
          repoSlug: targetRepo,
          parentPath,
          insertAfterPath: null,
          kind: "folder",
        });
      },
      onStartAddPage: (targetRepo, parentPath, insertAfterPath = null) => {
        setRenameTarget(null);
        setPageDraft({
          repoSlug: targetRepo,
          parentPath,
          insertAfterPath: insertAfterPath ?? null,
          kind: "page",
        });
      },
    }),
    [treesByRepo, projectSlug, refreshRepo, t, repoSlug, pagePath, reloadPage, navigate, router],
  );

  const inlineEdit = useMemo<KbInlineEdit>(
    () => ({
      draft: pageDraft,
      rename: renameTarget,
      onDraftSubmit: handleDraftSubmit,
      onRenameSubmit: handleRenameSubmit,
      onCancel: cancelInlineEdit,
    }),
    [pageDraft, renameTarget, handleDraftSubmit, handleRenameSubmit, cancelInlineEdit],
  );

  const pageFavorite = page?.frontmatter.favorite === true;

  const handlePageRename = useCallback(() => {
    if (!repoSlug || !pagePath || !page) return;
    treeHandlers.onRename(repoSlug, pagePath, page.title);
  }, [repoSlug, pagePath, page, treeHandlers]);

  const handlePageFavorite = useCallback(() => {
    if (!repoSlug || !pagePath) return;
    treeHandlers.onToggleFavorite(repoSlug, pagePath, pageFavorite);
  }, [repoSlug, pagePath, pageFavorite, treeHandlers]);

  const handlePageDelete = useCallback(() => {
    if (!repoSlug || !pagePath || !page) return;
    treeHandlers.onDelete(repoSlug, pagePath, page.title, "page");
  }, [repoSlug, pagePath, page, treeHandlers]);

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="w-64 shrink-0 border-r">
        {overview ? (
          <KbSidebar
            projectSlug={projectSlug}
            overview={overview}
            treesByRepo={treesByRepo}
            activeRepo={repoSlug}
            activePath={pagePath}
            onSelectRepo={(slug) => navigate(router.repo(slug))}
            onSearchSelect={handleSearchSelect}
            treeHandlers={treeHandlers}
            inlineEdit={inlineEdit}
            pageHref={router.page}
            singleRepo={singleRepo}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("kb.loading")}</p>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {repoSlug && pagePath && isAssetPath ? (
            <KbAssetPreview projectSlug={projectSlug} repoSlug={repoSlug} assetPath={pagePath} />
          ) : repoSlug && pagePath ? (
            page ? (
              <KbEditor
                key={`${repoSlug}/${pagePath}`}
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
                assistantActive={assistantOpen}
                onToggleAssistant={toggleAssistant}
                onRegisterContext={handleRegisterContext}
                githubFileUrl={githubFileUrl}
                pagePath={pagePath}
                frontmatter={page.frontmatter}
              />
            ) : (
              <p className="p-8 text-sm text-muted-foreground">
                {pageLoading ? t("kb.loading") : t("kb.errors.loadFailed")}
              </p>
            )
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                <p className="text-base font-medium">{t("kb.empty.title")}</p>
                <p className="text-sm text-muted-foreground">
                  {repoSlug ? t("kb.empty.repoBody") : t("kb.empty.selectPage")}
                </p>
                {repoSlug && (
                  <KbCreatePageForm
                    variant="empty"
                    onCreate={(title) => handleCreatePage(repoSlug, title)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Keep the chat mounted while a turn runs so the launcher stays "online"
          even after the panel is collapsed; only visually hide it when closed. */}
      {(assistantOpen || assistantRunning) && repoSlug && pagePath && page && !isAssetPath ? (
        <KbAssistantPanel
          projectSlug={projectSlug}
          repoSlug={repoSlug}
          pagePath={pagePath}
          pageTitle={page.title}
          getContext={getKbContext}
          onClose={() => setAssistantOpen(false)}
          onDocumentChanged={handleAssistantDocChanged}
          onRunningChange={handleRunningChange}
          hidden={!assistantOpen}
        />
      ) : null}

      {!assistantOpen && repoSlug && pagePath && page && !isAssetPath ? (
        <KbAssistantLauncher running={assistantRunning} onClick={() => setAssistantOpen(true)} />
      ) : null}
    </div>
  );
}
