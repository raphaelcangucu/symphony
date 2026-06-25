import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { KbEditor } from "@/components/kb/KbEditor";
import { KbSearchBar } from "@/components/kb/KbSearchBar";
import { KbSidebar } from "@/components/kb/KbSidebar";
import { KbSyncBadge } from "@/components/kb/KbSyncBadge";
import { useKbPage } from "@/hooks/useKbPage";
import { useKbProjectOverview } from "@/hooks/useKbProjectOverview";
import { useKbRepoTree } from "@/hooks/useKbRepoTree";
import { useKbSync } from "@/hooks/useKbSync";
import { kbPagePath } from "@/lib/kbRoutes";
import { savePage } from "@/services/knowledgeBase";
import type { KbSearchResult, KbTreeNode } from "@/types/knowledgeBase";

function parseSplat(splat: string): { repoSlug: string | null; pagePath: string | null } {
  const segments = splat.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return { repoSlug: null, pagePath: null };
  return {
    repoSlug: segments[0],
    pagePath: segments.length > 1 ? segments.slice(1).join("/") : null,
  };
}

function firstPagePath(nodes: KbTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "page") return node.path;
    const child = firstPagePath(node.children);
    if (child) return child;
  }
  return null;
}

export function KbProjectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const projectSlug = params.projectSlug ?? "";
  const { repoSlug, pagePath } = parseSplat(params["*"] ?? "");

  const { overview } = useKbProjectOverview(projectSlug);
  const { tree } = useKbRepoTree(projectSlug, repoSlug);
  const { page, loading: pageLoading } = useKbPage(projectSlug, repoSlug, pagePath);
  const { state: syncState, triggerSync } = useKbSync(projectSlug, repoSlug);
  const [saving, setSaving] = useState(false);

  const treesByRepo = useMemo(
    () => (repoSlug && tree ? { [repoSlug]: tree.tree } : {}),
    [repoSlug, tree],
  );

  // Opening a repository without a page lands on its first document.
  useEffect(() => {
    if (!repoSlug || pagePath || !tree) return;
    const first = firstPagePath(tree.tree);
    if (first) navigate(kbPagePath(projectSlug, repoSlug, first), { replace: true });
  }, [projectSlug, repoSlug, pagePath, tree, navigate]);

  const handleSave = useCallback(
    async (markdown: string) => {
      if (!repoSlug || !pagePath) return;
      setSaving(true);
      try {
        await savePage(projectSlug, repoSlug, pagePath, {
          frontmatter: page?.frontmatter ?? {},
          body: markdown,
        });
        toast.success(t("kb.saved"));
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
      navigate(kbPagePath(projectSlug, result.repoSlug, result.path));
    },
    [navigate, projectSlug],
  );

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
            onSelectRepo={(slug) => navigate(`/projects/${projectSlug}/kb/${slug}`)}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("kb.loading")}</p>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
          <KbSearchBar projectSlug={projectSlug} repo={repoSlug ?? undefined} onSelect={handleSearchSelect} />
          {repoSlug && <KbSyncBadge state={syncState} onSync={() => void triggerSync()} />}
        </div>

        <div className="min-h-0 flex-1">
          {repoSlug && pagePath ? (
            page ? (
              <KbEditor title={page.title} markdown={page.body} saving={saving} onSave={handleSave} />
            ) : (
              <p className="p-8 text-sm text-muted-foreground">
                {pageLoading ? t("kb.loading") : t("kb.errors.loadFailed")}
              </p>
            )
          ) : (
            <div className="p-8 text-sm text-muted-foreground">{t("kb.empty.selectPage")}</div>
          )}
        </div>
      </section>
    </div>
  );
}
