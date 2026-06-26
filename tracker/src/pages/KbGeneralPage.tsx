import { BookOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { KbWorkspace, type KbWorkspaceRouter } from "@/components/kb/KbWorkspace";
import { Button } from "@/components/ui/button";
import {
  GENERAL_KB_PROJECT_SLUG,
  GENERAL_KB_REPO_SLUG,
  kbGeneralPagePath,
  kbGeneralPath,
} from "@/lib/kbRoutes";
import { connectGeneral, getGeneralOverview } from "@/services/knowledgeBase";
import type { KbGeneralOverview } from "@/types/knowledgeBase";

const HOME_PAGE_PATH = "index.md";

export function KbGeneralPage() {
  const { t } = useTranslation();
  const pagePath = useParams()["*"] ?? "";

  const [overview, setOverview] = useState<KbGeneralOverview | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  // The personal KB lives at `/kb/<path>`; the repo is implicit, so page links
  // drop the repo segment and "select a repo" returns to the KB root.
  const router = useMemo<KbWorkspaceRouter>(
    () => ({
      page: (_repo, path) => kbGeneralPagePath(path),
      repo: () => kbGeneralPath(),
    }),
    [],
  );

  if (overview === null) {
    return <p className="p-4 text-sm text-muted-foreground">{t("kb.loading")}</p>;
  }

  if (!overview.connected) {
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
    <KbWorkspace
      projectSlug={GENERAL_KB_PROJECT_SLUG}
      repoSlug={GENERAL_KB_REPO_SLUG}
      pagePath={pagePath || null}
      router={router}
      defaultPagePath={HOME_PAGE_PATH}
      singleRepo
    />
  );
}
