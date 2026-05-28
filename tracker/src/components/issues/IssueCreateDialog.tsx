import { Plus } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createIssue } from "@/services/issues";
import type { Issue, IssuePriority } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { DEFAULT_WORKFLOW_STATUSES } from "../board/board-utils";

export const issueFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.enum(DEFAULT_WORKFLOW_STATUSES),
  priority: z.coerce.number().int().min(0).max(4).optional(),
});

export type IssueFormValues = z.infer<typeof issueFormSchema>;

interface IssueCreateDialogProps {
  projectSlug: string;
  onCreated?: (issue: Issue) => void;
}

export function IssueCreateDialog({ projectSlug, onCreated }: IssueCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkflowStatusName>("Todo");
  const [priority, setPriority] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = issueFormSchema.safeParse({ title, description, status, priority: priority || undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid issue");
      return;
    }

    setSubmitting(true);
    try {
      const issue = await createIssue(projectSlug, {
        title: parsed.data.title,
        description: parsed.data.description?.trim() || null,
        status: parsed.data.status,
        priority: parsed.data.priority as IssuePriority | undefined,
      });
      onCreated?.(issue);
      setTitle("");
      setDescription("");
      setPriority("");
      setStatus("Todo");
      setOpen(false);
      toast.success("Issue created");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to create issue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          New issue
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create issue</DialogTitle>
          <DialogDescription>Add a local tracker issue for this project.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Issue title" autoFocus />
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as WorkflowStatusName)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                {DEFAULT_WORKFLOW_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Priority</span>
              <Input value={priority} onChange={(event) => setPriority(event.target.value)} placeholder="0-4" inputMode="numeric" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
