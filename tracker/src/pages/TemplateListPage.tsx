import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { TemplateList } from "@/components/templates/TemplateList";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteTemplate, importTemplate, listTemplates } from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

export function TemplateListPage() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = async () => {
    try {
      const items = await listTemplates();
      setTemplates(items);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.templates.list.toasts.loadFailed"));
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);

    void listTemplates()
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          toast.error(cause instanceof Error ? cause.message : t("project.templates.list.toasts.loadFailed"));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [t]);

  const handleDelete = async (slug: string) => {
    const confirmed = window.confirm(t("project.templates.list.deleteConfirm", { slug }));
    if (!confirmed) return;

    try {
      await deleteTemplate(slug);
      setTemplates((current) => current.filter((template) => template.slug !== slug));
      toast.success(t("project.templates.list.toasts.deleted"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.templates.list.toasts.deleteFailed"));
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      await importTemplate(text);
      await loadTemplates();
      toast.success(t("project.templates.list.toasts.imported"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.templates.list.toasts.importFailed"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("project.templates.list.title")}</h1>
          <p className="text-sm text-muted-foreground sm:text-base">{t("project.templates.list.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,text/yaml,application/x-yaml"
            className="hidden"
            onChange={(event) => void handleImportFile(event)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {t("project.templates.list.import")}
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-40" />
      ) : (
        <TemplateList templates={templates} onDelete={(slug) => void handleDelete(slug)} />
      )}
    </div>
  );
}
