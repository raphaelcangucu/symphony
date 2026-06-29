import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { settingsTemplatesPath } from "@/lib/settingsRoutes";
import type { WorkspaceTemplate } from "@/types/template";

interface TemplateListProps {
  templates: WorkspaceTemplate[];
  onDelete: (slug: string) => void;
}

export function TemplateList({ templates, onDelete }: TemplateListProps) {
  const { t } = useTranslation();

  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("project.templates.list.empty")}</p>;
  }

  return (
    <div className="grid gap-2">
      {templates.map((template) => (
        <div key={template.id} className="flex items-center justify-between rounded-md border p-3">
          <Link to={settingsTemplatesPath(template.slug)} className="min-w-0">
            <span className="block text-sm font-medium">{template.name}</span>
            <span className="block text-xs text-muted-foreground">
              {t("project.templates.list.repoCount", { count: template.repositories.length })}
              {template.description ? ` · ${template.description}` : ""}
            </span>
          </Link>
          <Button size="sm" variant="ghost" onClick={() => onDelete(template.slug)}>
            {t("project.templates.list.delete")}
          </Button>
        </div>
      ))}
    </div>
  );
}
