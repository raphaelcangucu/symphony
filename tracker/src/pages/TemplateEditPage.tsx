import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { TemplateForm } from "@/components/templates/TemplateForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTemplate } from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

export function TemplateEditPage() {
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
        if (active) toast.error(cause instanceof Error ? cause.message : "Unable to load template");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <div className="min-h-screen p-6">
      <div className="mb-6 flex items-center gap-3">
        <Button asChild type="button" variant="ghost" size="sm">
          <Link to="/templates">
            <ArrowLeft className="h-4 w-4" />
            Templates
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{template ? template.name : "Edit template"}</h1>
      </div>

      <main className="min-w-0 max-w-3xl">
        {loading ? (
          <Skeleton className="h-72" />
        ) : template ? (
          <TemplateForm template={template} onSaved={setTemplate} />
        ) : (
          <p className="text-sm text-muted-foreground">Template not found.</p>
        )}
      </main>
    </div>
  );
}
