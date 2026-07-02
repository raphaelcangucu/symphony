import { Link2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function looksLikeUrl(value: string) {
  return /^https:\/\/.+/i.test(value.trim());
}

interface ProjectImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName?: string;
  confirmMessage?: (sourceLabel: string) => string;
  onImportFile: (yaml: string, fileName: string) => Promise<void>;
  onImportUrl: (url: string) => Promise<void>;
}

export function ProjectImportDialog({
  open,
  onOpenChange,
  projectName,
  confirmMessage,
  onImportFile,
  onImportUrl,
}: ProjectImportDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetAndClose = () => {
    setUrl("");
    onOpenChange(false);
  };

  const confirmIfNeeded = (sourceLabel: string) => {
    if (!confirmMessage) return true;
    return window.confirm(confirmMessage(sourceLabel));
  };

  const handleImportUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!looksLikeUrl(trimmed)) return;

    if (!confirmIfNeeded(trimmed)) return;

    setSubmitting(true);
    try {
      await onImportUrl(trimmed);
      resetAndClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!confirmIfNeeded(file.name)) return;

    setSubmitting(true);
    try {
      const yaml = await file.text();
      await onImportFile(yaml, file.name);
      resetAndClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleUrlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && url.trim() && looksLikeUrl(url)) {
      event.preventDefault();
      void handleImportUrl();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project.config.importExport.importTitle")}</DialogTitle>
          <DialogDescription>
            {projectName
              ? t("project.config.importExport.importDescriptionNamed", { projectName })
              : t("project.config.importExport.importDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-import-url">{t("project.config.importExport.importFromUrlLabel")}</Label>
            <Input
              id="project-import-url"
              type="url"
              placeholder="https://gist.githubusercontent.com/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={handleUrlKeyDown}
              disabled={submitting}
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            {t("project.config.importExport.importOrFile")}
            <div className="h-px flex-1 bg-border" />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,text/yaml,application/x-yaml"
            className="hidden"
            onChange={(event) => void handleImportFile(event)}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={submitting}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {t("project.config.importExport.importChooseFile")}
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => resetAndClose()} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleImportUrl()}
            disabled={submitting || !looksLikeUrl(url)}
          >
            <Link2 className="h-4 w-4" />
            {t("project.config.importExport.importSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { looksLikeUrl };
