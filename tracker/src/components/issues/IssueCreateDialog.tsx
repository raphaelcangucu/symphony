import { Plus } from "lucide-react";
import { FormEvent, ReactNode, SVGProps, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createIssue, getIssueFormOptions } from "@/services/issues";
import type {
  AgentKind,
  Issue,
  IssueAssigneeOption,
  IssueFormOptions,
  IssueLabelOption,
  IssuePriority,
} from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { DEFAULT_WORKFLOW_STATUSES } from "../board/board-utils";

export const issueFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.string().trim().min(1, "Status is required"),
  priority: z.coerce.number().int().min(0).max(4).optional(),
});

export type IssueFormValues = z.infer<typeof issueFormSchema>;

const SYMPHONY_LABEL_PATTERN = /^symphony(:.*)?$/i;

interface IssueCreateDialogProps {
  projectSlug: string;
  onCreated?: (issue: Issue) => void;
  /** Pre-select the status (e.g. when opened from a specific column). */
  defaultStatus?: WorkflowStatusName;
  /** Status options to choose from. Falls back to the default workflow. */
  statuses?: readonly WorkflowStatusName[];
  /** Custom trigger element. When omitted, a default "New issue" button is rendered. */
  trigger?: ReactNode;
  /** Controlled open state. When provided the parent owns visibility. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function labelValue(label: IssueLabelOption): string {
  return label.id ?? label.name;
}

function assigneeValue(assignee: IssueAssigneeOption): string | null {
  return assignee.id ?? assignee.login ?? null;
}

function assigneeLabel(assignee: IssueAssigneeOption): string {
  return assignee.login ?? assignee.name ?? "unknown";
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function IssueCreateDialog({
  projectSlug,
  onCreated,
  defaultStatus = "Todo",
  statuses,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: IssueCreateDialogProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkflowStatusName>(defaultStatus);
  const [priority, setPriority] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [agent, setAgent] = useState<AgentKind | "">("");
  const [submitting, setSubmitting] = useState(false);

  const [options, setOptions] = useState<IssueFormOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);

  const fallbackStatuses = statuses && statuses.length > 0 ? statuses : DEFAULT_WORKFLOW_STATUSES;
  const statusOptions =
    options && options.statuses.length > 0 ? options.statuses : fallbackStatuses;
  const visibleLabels = (options?.labels ?? []).filter((label) => !SYMPHONY_LABEL_PATTERN.test(label.name));
  const assigneeOptions = options?.assignees ?? [];
  const agentOptions = options?.agents ?? [];

  useEffect(() => {
    if (open) setStatus(defaultStatus);
  }, [open, defaultStatus]);

  useEffect(() => {
    if (!open || !projectSlug.trim()) return;

    let cancelled = false;
    setOptionsLoading(true);
    getIssueFormOptions(projectSlug)
      .then((result) => {
        if (cancelled) return;
        setOptions(result);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions({ labels: [], assignees: [], statuses: [], agents: [] });
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectSlug]);

  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority("");
    setStatus(defaultStatus);
    setSelectedLabels([]);
    setSelectedAssignees([]);
    setAgent("");
  }

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
        labelIds: selectedLabels,
        assigneeIds: selectedAssignees,
        agent: agent || null,
      });
      onCreated?.(issue);
      resetForm();
      setOpen(false);
      toast.success("Issue created");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to create issue");
    } finally {
      setSubmitting(false);
    }
  }

  const showTrigger = trigger !== undefined || !isControlled;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New issue
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create issue</DialogTitle>
          <DialogDescription>Add an issue to this project's tracker.</DialogDescription>
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
                {statusOptions.map((item) => (
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

          {agentOptions.length > 0 ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Agent</span>
              <select
                value={agent}
                onChange={(event) => setAgent(event.target.value as AgentKind | "")}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">None</option>
                {agentOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                    {item.default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <ChipPicker
            title="Labels"
            emptyText={optionsLoading ? "Loading labels..." : "No labels available."}
            items={visibleLabels.map((label) => ({ value: labelValue(label), label: label.name }))}
            selected={selectedLabels}
            onToggle={(value) => setSelectedLabels((current) => toggle(current, value))}
          />

          <ChipPicker
            title="Assignees"
            emptyText={optionsLoading ? "Loading assignees..." : "No assignees available."}
            items={assigneeOptions
              .map((assignee) => ({ value: assigneeValue(assignee), label: assigneeLabel(assignee) }))
              .filter((item): item is { value: string; label: string } => item.value !== null)}
            selected={selectedAssignees}
            onToggle={(value) => setSelectedAssignees((current) => toggle(current, value))}
          />

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

interface ChipPickerProps {
  title: string;
  emptyText: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}

function ChipPicker({ title, emptyText, items, selected, onToggle }: ChipPickerProps) {
  return (
    <div className="space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {items.map((item) => {
            const active = selected.includes(item.value);
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(item.value)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
