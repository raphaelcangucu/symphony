import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { WorkspaceTemplate } from "@/types/template";

interface TemplateListProps {
  templates: WorkspaceTemplate[];
  onDelete: (slug: string) => void;
}

export function TemplateList({ templates, onDelete }: TemplateListProps) {
  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No templates yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {templates.map((template) => (
        <div key={template.id} className="flex items-center justify-between rounded-md border p-3">
          <Link to={`/templates/${encodeURIComponent(template.slug)}`} className="min-w-0">
            <span className="block text-sm font-medium">{template.name}</span>
            <span className="block text-xs text-muted-foreground">
              {template.repositories.length} repo{template.repositories.length === 1 ? "" : "s"}
              {template.description ? ` · ${template.description}` : ""}
            </span>
          </Link>
          <Button size="sm" variant="ghost" onClick={() => onDelete(template.slug)}>Delete</Button>
        </div>
      ))}
    </div>
  );
}
