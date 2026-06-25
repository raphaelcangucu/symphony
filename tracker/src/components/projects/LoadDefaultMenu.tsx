import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { listTemplates } from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

export interface LoadedDefault {
  promptTemplate: string;
  afterCreateHook: string | null;
  validationCommands: string[];
}

export function LoadDefaultMenu({ onLoad }: { onLoad: (value: LoadedDefault) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);

  useEffect(() => {
    if (!open) return;
    listTemplates()
      .then(setTemplates)
      .catch((cause) =>
        toast.error(cause instanceof Error ? cause.message : t("project.config.loadDefault.loadFailed")),
      );
  }, [open, t]);

  return (
    <div className="relative">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
        <Download className="h-4 w-4" />
        {t("project.config.loadDefault.trigger")}
      </Button>
      {open ? (
        <div className="absolute z-10 mt-1 w-56 rounded-md border bg-popover p-1 shadow-md">
          {templates.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">{t("project.config.loadDefault.empty")}</p>
          ) : (
            templates.map((template) => (
              <button
                key={template.slug}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onLoad({
                    promptTemplate: template.promptTemplate ?? "",
                    afterCreateHook: template.afterCreateHook ?? null,
                    validationCommands: template.validationCommands ?? [],
                  });
                  setOpen(false);
                }}
              >
                {template.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
