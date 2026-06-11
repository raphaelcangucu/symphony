import { Download, Upload } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { exportProject, importProjectConfig } from "@/services/projectImportExport";
import type { Project } from "@/types/project";

interface ProjectImportExportActionsProps {
  project: Project;
  onImported: (project: Project) => void;
}

export function ProjectImportExportActions({ project, onImported }: ProjectImportExportActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      const yaml = await exportProject(project.slug);
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.slug}-project.yaml`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Project configuration exported");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to export project configuration");
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const confirmed = window.confirm(
      `Import configuration from "${file.name}" into "${project.name}"? This replaces the current settings.`,
    );
    if (!confirmed) return;

    try {
      const yaml = await file.text();
      const updated = await importProjectConfig(project.slug, yaml);
      onImported(updated);
      toast.success("Project configuration imported");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to import project configuration");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,text/yaml,application/x-yaml"
        className="hidden"
        onChange={(event) => void handleImportFile(event)}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => void handleExport()}>
        <Download className="h-4 w-4" />
        Export
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
        <Upload className="h-4 w-4" />
        Import
      </Button>
    </div>
  );
}
