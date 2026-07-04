import { ChevronRight, GitBranch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { KbProjectOverview, KbSearchResult, KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";
import type { KbInlineEdit } from "@/types/kbPageDraft";

import { KbAddNodeButton } from "./KbAddNodeButton";
import { KbSidebarSearch } from "./KbSidebarSearch";
import type { KbTreeHandlers } from "./KbTreeList";
import { KbTreeList } from "./KbTreeList";

const COLLAPSED_REPOS_KEY = "kb-sidebar-collapsed-repos";

function readCollapsedRepos(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_REPOS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function writeCollapsedRepos(collapsed: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_REPOS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Preference only.
  }
}

interface Props {
  projectSlug: string;
  overview: KbProjectOverview;
  treesByRepo: Record<string, KbTreeNodeType[]>;
  activeRepo: string | null;
  activePath: string | null;
  onSelectRepo: (repoSlug: string) => void;
  onSearchSelect: (result: KbSearchResult) => void;
  treeHandlers: KbTreeHandlers;
  inlineEdit: KbInlineEdit;
  /** Builds the route for a page/asset so the tree works in both KB scopes. */
  pageHref: (repoSlug: string, pagePath: string) => string;
  /** Optional in-place selection for embedded KB surfaces that should not route away. */
  onSelectPath?: (repoSlug: string, pagePath: string) => void;
  /** Optional per-node action used by embedded KB surfaces, e.g. composer context insertion. */
  onInsertContext?: (repoSlug: string, node: KbTreeNodeType) => void;
  /** Hides the per-repository header chrome when the scope has one implicit repo. */
  singleRepo?: boolean;
  /** Render navigation/search only, hiding editing and reorder controls. */
  readOnly?: boolean;
}

export function KbSidebar({
  projectSlug,
  overview,
  treesByRepo,
  activeRepo,
  activePath,
  onSelectRepo,
  onSearchSelect,
  treeHandlers,
  inlineEdit,
  pageHref,
  onSelectPath,
  onInsertContext,
  singleRepo = false,
  readOnly = false,
}: Props) {
  const { t } = useTranslation();
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(() => readCollapsedRepos());

  useEffect(() => {
    writeCollapsedRepos(collapsedRepos);
  }, [collapsedRepos]);

  useEffect(() => {
    const draft = inlineEdit.draft;
    if (!draft) return;
    setCollapsedRepos((prev) => {
      if (!prev.has(draft.repoSlug)) return prev;
      const next = new Set(prev);
      next.delete(draft.repoSlug);
      return next;
    });
  }, [inlineEdit.draft]);

  const toggleRepo = useCallback((repoSlug: string) => {
    setCollapsedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoSlug)) next.delete(repoSlug);
      else next.add(repoSlug);
      return next;
    });
  }, []);

  return (
    <nav className="flex h-full flex-col overflow-hidden">
      <KbSidebarSearch projectSlug={projectSlug} onSelect={onSearchSelect} />

      <div className="flex-1 overflow-y-auto p-2 pt-0 scrollbar-discrete">
        {overview.repositories.map((repo) => {
          const nodes = treesByRepo[repo.repoSlug] ?? [];
          const collapsed = !singleRepo && collapsedRepos.has(repo.repoSlug);
          const isActiveRepo = activeRepo === repo.repoSlug;
          const repoDraftActive =
            inlineEdit.draft?.repoSlug === repo.repoSlug && inlineEdit.draft.parentPath === "";

          return (
            <section key={repo.repoSlug} className="mb-3">
              {singleRepo ? (
                <div className="flex items-center justify-between px-1 pt-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("kb.sidebar.pages")}
                  </span>
                  {readOnly ? null : (
                    <KbAddNodeButton
                      onAddPage={() => treeHandlers.onStartAddPage(repo.repoSlug, "", null)}
                      onCreateFolder={() => treeHandlers.onCreateFolder(repo.repoSlug, "")}
                    />
                  )}
                </div>
              ) : (
                <div
                  className={cn(
                    "group/repo flex min-w-0 items-center rounded-md hover:bg-accent/50",
                    isActiveRepo && "bg-accent/30",
                  )}
                >
                  <button
                    type="button"
                    className="flex h-7 w-6 shrink-0 items-center justify-center text-muted-foreground"
                    aria-expanded={!collapsed}
                    onClick={() => toggleRepo(repo.repoSlug)}
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", !collapsed && "rotate-90")} />
                  </button>
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className={cn(
                      "min-w-0 flex-1 truncate px-1 py-1.5 text-left text-xs font-semibold uppercase tracking-wide",
                      isActiveRepo ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    title={repo.githubFullName ?? repo.workspacePath}
                    onClick={() => onSelectRepo(repo.repoSlug)}
                  >
                    {repo.workspacePath}
                  </button>
                  {readOnly ? null : (
                    <KbAddNodeButton
                      onAddPage={() => treeHandlers.onStartAddPage(repo.repoSlug, "", null)}
                      onCreateFolder={() => treeHandlers.onCreateFolder(repo.repoSlug, "")}
                    />
                  )}
                </div>
              )}

              {!collapsed ? (
                <div className="mt-0.5">
                  {nodes.length > 0 || repoDraftActive ? (
                    <KbTreeList
                      projectSlug={projectSlug}
                      repoSlug={repo.repoSlug}
                      nodes={nodes}
                      activePath={isActiveRepo ? activePath : null}
                      handlers={treeHandlers}
                      inlineEdit={inlineEdit}
                      pageHref={pageHref}
                      onSelectPath={onSelectPath}
                      onInsertContext={onInsertContext}
                      readOnly={readOnly}
                    />
                  ) : null}
                  {nodes.length === 0 && !repo.docsPresent && !repoDraftActive ? (
                    <p className="px-6 py-1 text-xs text-muted-foreground">{t("kb.sidebar.noDocs")}</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </nav>
  );
}
