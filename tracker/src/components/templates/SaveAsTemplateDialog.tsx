import { FormEvent, useState } from "react";
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
      toast.success("Template saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to save template");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">Save as template</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save project as template</DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="template-slug" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save template"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
