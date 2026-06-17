import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { saveProjectAsTemplate } from "@/services/templates";
import type { WorkspaceTemplate } from "@/types/template";

interface SaveAsTemplateDialogProps {
  projectSlug: string;
  onSaved?: (template: WorkspaceTemplate) => void;
}

export function SaveAsTemplateDialog({ projectSlug, onSaved }: SaveAsTemplateDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const template = await saveProjectAsTemplate(projectSlug, { name: name || undefined, slug: slug || undefined });
      onSaved?.(template);
      setOpen(false);
      toast.success(t("project.templates.toasts.saved"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.templates.toasts.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">{t("project.templates.saveAsTemplate")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project.templates.saveAsTitle")}</DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("project.templates.form.namePlaceholder")}
          />
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t("project.templates.slugPlaceholder")}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("project.config.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("project.templates.form.saving") : t("project.templates.form.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
