import { Plus } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "@/services/projects";
import type { Project } from "@/types/project";

const projectFormSchema = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  slug: z
    .string()
    .trim()
    .min(1, "Project slug is required")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase URL slug such as macro-markets"),
  description: z.string().optional(),
});

interface ProjectCreateDialogProps {
  onCreated?: (project: Project) => void;
}

export function ProjectCreateDialog({ onCreated }: ProjectCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = projectFormSchema.safeParse({ name, slug, description });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid project");
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
      toast.success("Project created");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>Add a local project board backed by the tracker API.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" autoFocus />
          <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="project-slug" />
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
