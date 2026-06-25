import { Plus } from "lucide-react";
import type { TFunction } from "i18next";
import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "@/services/projects";
import type { Project } from "@/types/project";

function projectFormSchema(t: TFunction) {
  return z.object({
    name: z.string().trim().min(1, t("project.createDialog.validation.nameRequired")),
    slug: z
      .string()
      .trim()
      .min(1, t("project.createDialog.validation.slugRequired"))
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, t("project.createDialog.validation.slugFormat")),
    description: z.string().optional(),
  });
}

interface ProjectCreateDialogProps {
  onCreated?: (project: Project) => void;
}

export function ProjectCreateDialog({ onCreated }: ProjectCreateDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = projectFormSchema(t).safeParse({ name, slug, description });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("project.createDialog.validation.invalid"));
      return;
    }

    setSubmitting(true);

    try {
      const project = await createProject({
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description?.trim() || null,
      });
      onCreated?.(project);
      setName("");
      setSlug("");
      setDescription("");
      setOpen(false);
      toast.success(t("project.createDialog.created"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.createDialog.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          {t("project.createDialog.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("project.createDialog.title")}</DialogTitle>
          <DialogDescription>{t("project.createDialog.description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("project.createDialog.namePlaceholder")}
            autoFocus
          />
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={t("project.createDialog.slugPlaceholder")}
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("project.createDialog.descriptionPlaceholder")}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("project.createDialog.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("project.createDialog.creating") : t("project.createDialog.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
