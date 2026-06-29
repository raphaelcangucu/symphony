import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { TemplateForm } from "@/components/templates/TemplateForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTemplate } from "@/services/templates";
import { settingsTemplatesPath } from "@/lib/settingsRoutes";
import type { WorkspaceTemplate } from "@/types/template";

export function TemplateEditPage() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const [template, setTemplate] = useState<WorkspaceTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;

    let active = true;
    setLoading(true);

    void getTemplate(slug)
      .then((item) => {
        if (active) setTemplate(item);
      })
      .catch((cause: unknown) => {
        if (active) toast.error(cause instanceof Error ? cause.message : t("project.templates.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, t]);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Button asChild type="button" variant="ghost" size="sm">
          <Link to={settingsTemplatesPath()}>
            <ArrowLeft className="h-4 w-4" />
            {t("project.templates.back")}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{template ? template.name : t("project.templates.editTitle")}</h1>
      </div>

      <main className="min-w-0 max-w-3xl">
        {loading ? (
          <Skeleton className="h-72" />
        ) : template ? (
          <TemplateForm template={template} onSaved={setTemplate} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("project.templates.notFound")}</p>
        )}
      </main>
    </div>
  );
}
