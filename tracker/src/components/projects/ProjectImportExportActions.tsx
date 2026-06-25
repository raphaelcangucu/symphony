import { Download, Share2, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ProjectImportDialog } from "@/components/projects/ProjectImportDialog";
import { Button } from "@/components/ui/button";
import {
  exportProject,
  importProjectConfig,
  importProjectConfigFromUrl,
  shareProject,
} from "@/services/projectImportExport";
import type { Project } from "@/types/project";

interface ProjectImportExportActionsProps {
  project: Project;
  onImported: (project: Project) => void;
}

export function ProjectImportExportActions({ project, onImported }: ProjectImportExportActionsProps) {
  const { t } = useTranslation();
  const [importOpen, setImportOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const handleExport = async () => {
    try {
      const yaml = await exportProject(project.slug);
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.slug}.yaml`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t("project.config.importExport.exportSuccess"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.config.importExport.exportFailed"));
    }
  };

  const handleImportFile = async (yaml: string, _fileName: string) => {
    try {
      const updated = await importProjectConfig(project.slug, yaml);
      onImported(updated);
      toast.success(t("project.config.importExport.importSuccess"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.config.importExport.importFailed"));
      throw cause;
    }
  };

  const handleImportUrl = async (url: string) => {
    try {
      const updated = await importProjectConfigFromUrl(project.slug, url);
      onImported(updated);
      toast.success(t("project.config.importExport.importSuccess"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.config.importExport.importFailed"));
      throw cause;
    }
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const info = await shareProject(project.slug);
      const shareUrl = info.raw_url ?? info.html_url;
      if (shareUrl) {
        await navigator.clipboard.writeText(shareUrl);
      }
      toast.success(t("project.config.importExport.shareSuccess"), {
        description: shareUrl,
        action: shareUrl
          ? {
              label: t("project.config.importExport.openShareLink"),
              onClick: () => window.open(info.html_url, "_blank", "noopener,noreferrer"),
            }
          : undefined,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.config.importExport.shareFailed"));
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void handleExport()}>
          <Download className="h-4 w-4" />
          {t("project.config.importExport.export")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" />
          {t("project.config.importExport.import")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={sharing} onClick={() => void handleShare()}>
          <Share2 className="h-4 w-4" />
          {t("project.config.importExport.share")}
        </Button>
      </div>
      <ProjectImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectName={project.name}
        confirmMessage={(sourceLabel) =>
          t("project.config.importExport.importConfirm", { fileName: sourceLabel, projectName: project.name })
        }
        onImportFile={handleImportFile}
        onImportUrl={handleImportUrl}
      />
    </>
  );
}
