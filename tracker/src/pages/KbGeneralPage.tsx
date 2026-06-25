import { BookOpen, FileText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { KbEditor } from "@/components/kb/KbEditor";
import { Button } from "@/components/ui/button";
import { kbGeneralPagePath } from "@/lib/kbRoutes";
import { cn } from "@/lib/utils";
import {
  connectGeneral,
  getGeneralOverview,
  getGeneralPage,
  regenerateGeneralHome,
  saveGeneralPage,
} from "@/services/knowledgeBase";
import type { KbGeneralOverview, KbPage, KbTreeNode } from "@/types/knowledgeBase";

function GeneralTree({ nodes, depth = 0 }: { nodes: KbTreeNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "folder" ? (
          <div key={node.path}>
            <p
              className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ paddingLeft: depth * 12 + 8 }}
            >
              {node.title || node.name}
            </p>
            <GeneralTree nodes={node.children} depth={depth + 1} />
          </div>
        ) : (
          <NavLink
            key={node.path}
            to={kbGeneralPagePath(node.path)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent",
                isActive && "bg-accent font-medium text-foreground",
              )
            }
            style={{ paddingLeft: depth * 12 + 8 }}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{node.title || node.name}</span>
          </NavLink>
        ),
      )}
    </>
  );
}

export function KbGeneralPage() {
  const { t } = useTranslation();
  const pagePath = useParams()["*"] ?? "";

  const [overview, setOverview] = useState<KbGeneralOverview | null>(null);
  const [page, setPage] = useState<KbPage | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await getGeneralOverview());
    } catch {
      setOverview({ connected: false, tree: [] });
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!pagePath) {
      setPage(null);
      return;
    }
    let active = true;
    void getGeneralPage(pagePath)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch(() => {
        if (active) setPage(null);
      });
    return () => {
      active = false;
    };
  }, [pagePath]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await connectGeneral();
      await loadOverview();
      toast.success(t("kb.general.connected"));
    } catch {
      toast.error(t("kb.general.connectFailed"));
    } finally {
      setConnecting(false);
    }
  }, [loadOverview, t]);

  const handleRegenerate = useCallback(async () => {
    try {
      await regenerateGeneralHome();
      await loadOverview();
      toast.success(t("kb.general.regenerated"));
    } catch {
      toast.error(t("kb.errors.saveFailed"));
    }
  }, [loadOverview, t]);

  const handleSave = useCallback(
    async (markdown: string) => {
      if (!pagePath) return;
      setSaving(true);
      try {
        await saveGeneralPage(pagePath, { frontmatter: page?.frontmatter ?? {}, body: markdown });
        toast.success(t("kb.saved"));
      } catch {
        toast.error(t("kb.errors.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [pagePath, page, t],
  );

  if (overview && !overview.connected) {
    return (
      <div className="mx-auto max-w-md p-12 text-center">
        <BookOpen className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
        <h1 className="mb-2 text-lg font-semibold">{t("kb.general.title")}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t("kb.general.connectHint")}</p>
        <Button onClick={() => void handleConnect()} disabled={connecting}>
          {connecting ? t("kb.general.connecting") : t("kb.general.connect")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="flex w-64 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t("kb.general.title")}</span>
          <Button size="sm" variant="ghost" onClick={() => void handleRegenerate()} title={t("kb.general.regenerate")}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <nav className="flex flex-col gap-0.5 overflow-y-auto p-2">
          {overview ? <GeneralTree nodes={overview.tree} /> : <p className="px-2 text-sm text-muted-foreground">{t("kb.loading")}</p>}
        </nav>
      </aside>

      <section className="min-w-0 flex-1">
        {pagePath && page ? (
          <KbEditor title={page.title} markdown={page.body} saving={saving} onSave={handleSave} />
        ) : (
          <div className="p-8 text-sm text-muted-foreground">{t("kb.empty.selectPage")}</div>
        )}
      </section>
    </div>
  );
}
