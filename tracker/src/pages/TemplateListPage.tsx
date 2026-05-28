import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { TemplateList } from "@/components/templates/TemplateList";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteTemplate, importTemplate, listTemplates } from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

export function TemplateListPage() {
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = async () => {
    try {
      const items = await listTemplates();
      setTemplates(items);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to load templates");
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
        if (active) toast.error(cause instanceof Error ? cause.message : "Unable to load templates");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleDelete = async (slug: string) => {
    const confirmed = window.confirm(`Delete template "${slug}" permanently? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteTemplate(slug);
      setTemplates((current) => current.filter((template) => template.slug !== slug));
      toast.success("Template deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to delete template");
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
      toast.success("Template imported");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Unable to import template");
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Templates</h1>
          <p className="text-sm text-muted-foreground">Reusable workspace blueprints.</p>
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
            Import
          </Button>
        </div>
      </div>

      <main className="min-w-0">
        {loading ? <Skeleton className="h-40" /> : <TemplateList templates={templates} onDelete={(slug) => void handleDelete(slug)} />}
      </main>
    </div>
  );
}
