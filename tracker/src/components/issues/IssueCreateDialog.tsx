import { Plus } from "lucide-react";
import { FormEvent, ReactElement, ReactNode, SVGProps, useEffect, useState } from "react";
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

function buildCodexGoal(title: string, description: string): string {
  const objective = title.trim() || "Complete this issue";
  const details = description.trim();
  const lines = [`Objective: ${objective}`];

  if (details) lines.push(`Context: ${details}`);

  lines.push(
    "Constraints: follow existing issue artifacts, specs, and plans when present; verify changes before reporting completion; stop when complete or blocked.",
  );

  return lines.join("\n");
}

function CodexIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A5.98 5.98 0 0 0 10.74 0a6.05 6.05 0 0 0-5.77 4.19 5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.05 6.05 0 0 0 5.77-4.2 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.74-7.08Zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49ZM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.65ZM2.34 7.9a4.48 4.48 0 0 1 2.34-1.97V11.6a.78.78 0 0 0 .39.68l5.84 3.37-2.02 1.17a.07.07 0 0 1-.07 0L4 14.03a4.5 4.5 0 0 1-1.66-6.14Zm16.6 3.85L13.1 8.37l2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.78.78 0 0 0-.39-.67Zm2.01-3.02-.14-.09-4.78-2.78a.78.78 0 0 0-.79 0L9.42 9.23V6.9a.07.07 0 0 1 .03-.07l4.83-2.79a4.49 4.49 0 0 1 6.67 4.65ZM8.32 12.87 6.3 11.7a.08.08 0 0 1-.04-.06V6.07a4.49 4.49 0 0 1 7.36-3.44l-.14.08L8.7 5.47a.78.78 0 0 0-.39.68ZM9.42 10.5 12.03 9l2.6 1.5v3l-2.6 1.5-2.61-1.5Z" />
    </svg>
  );
}

function ClaudeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M4.71 15.16 9.4 12.5l.08-.23-.08-.13H9.2l-.8-.05-2.74-.07-2.37-.1-2.3-.12-.58-.13L0 10.96l.06-.36.49-.33.69.06 1.53.1 2.3.16 1.66.1 2.47.26h.39l.06-.16-.14-.1-.1-.1-2.5-1.7-2.7-1.79-1.42-1.03-.77-.52-.38-.49-.17-1.06.69-.76.92.06.24.07.94.72 2 1.55 2.61 1.93.39.32.15-.11.02-.08-.17-.29-1.45-2.61-1.54-2.66-.69-1.1-.18-.66a3.2 3.2 0 0 1-.11-.78l.78-1.06L6 0l1.06.15.45.39 1.45 4.6L9.5 6.27l.08.34h.08L9.84 6.45l.07-.4 1.06-4.41 1.18-1.4 1.36-1.46 1.07.06.7.97-.41 1.44L13.69 5l-.7 2.62-.45 1.42.07.11.16.04 2.69-1.16 1.86-.81L19.43 6.83l1.06.15.13.93-.62.96-2.01 1.4-2.36 1.6-1.45.93-.04.1.06.07 2.5-.24.97.04 1.5.13.4.27.23.4-.27.95-3.39.85-2.42-.55h-.31l-.07.13.42 1.05 1.34 2.49 1.43 2.59-.4 1.23-.7.45-.78-.07-.46-.62-1.27-2.32-1.51-2.81-.7-1.18-.16.08-.8 8.1-.36.41-.85.33-.7-.54-.37-.86.37-1.71 1.06-3.13.31-1.45.31-1.86-.16-.43-.05-.06-.94.13-3.62.5-1.27.1-.36-.3-.31-1.06.13-.94.45-.6Z" />
    </svg>
  );
}

const AGENT_ICONS: Record<AgentKind, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  codex: CodexIcon,
  claude: ClaudeIcon,
};

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
  const [codexGoalMode, setCodexGoalMode] = useState(false);
  const [codexGoal, setCodexGoal] = useState("");
  const [codexGoalEdited, setCodexGoalEdited] = useState(false);
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
    if (agent !== "codex") setCodexGoalMode(false);
  }, [agent]);

  useEffect(() => {
    if (agent === "codex" && codexGoalMode && !codexGoalEdited) {
      setCodexGoal(buildCodexGoal(title, description));
    }
  }, [agent, codexGoalEdited, codexGoalMode, description, title]);

  useEffect(() => {
    if (!open || !projectSlug.trim()) return;

    let cancelled = false;
    setOptionsLoading(true);
    getIssueFormOptions(projectSlug)
      .then((result) => {
        if (cancelled) return;
        setOptions(result);
        const defaultAgent = result.agents.find((option) => option.default);
        if (defaultAgent) setAgent(defaultAgent.value);
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
    setCodexGoalMode(false);
    setCodexGoal("");
    setCodexGoalEdited(false);
  }

  function handleGoalModeChange(checked: boolean) {
    setCodexGoalMode(checked);
    setCodexGoalEdited(false);
    setCodexGoal(checked ? buildCodexGoal(title, description) : "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = issueFormSchema.safeParse({ title, description, status, priority: priority || undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid issue");
      return;
    }
    if (agent === "codex" && codexGoalMode && !codexGoal.trim()) {
      toast.error("Goal mode requires a goal.");
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
        goal: agent === "codex" && codexGoalMode ? codexGoal.trim() || null : null,
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
            <div className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Agent</span>
              <div className="flex flex-wrap gap-1.5">
                <AgentChip label="None" active={agent === ""} onClick={() => setAgent("")} />
                {agentOptions.map((item) => {
                  const Icon = AGENT_ICONS[item.value];
                  return (
                    <AgentChip
                      key={item.value}
                      label={item.label}
                      icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
                      active={agent === item.value}
                      onClick={() => setAgent(item.value)}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {agent === "codex" ? (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={codexGoalMode}
                  onChange={(event) => handleGoalModeChange(event.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Goal mode (long-running)
              </label>
              {codexGoalMode ? (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Codex goal</span>
                  <Textarea
                    value={codexGoal}
                    onChange={(event) => {
                      setCodexGoalEdited(true);
                      setCodexGoal(event.target.value);
                    }}
                    className="min-h-28"
                    aria-label="Codex goal"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <ChipPicker
            title="Labels"
            emptyText={optionsLoading ? "Loading labels..." : "No labels available."}
            items={visibleLabels.map((label) => ({
              value: labelValue(label),
              label: label.name,
              color: label.color,
            }))}
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

interface ChipItem {
  value: string;
  label: string;
  color?: string | null;
}

interface ChipPickerProps {
  title: string;
  emptyText: string;
  items: ReadonlyArray<ChipItem>;
  selected: string[];
  onToggle: (value: string) => void;
}

function normalizeHexColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(trimmed)) return null;
  return `#${trimmed}`;
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
            const hex = normalizeHexColor(item.color);
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(item.value)}
                style={hex ? { borderColor: hex } : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted",
                )}
              >
                {hex ? (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: hex }}
                    aria-hidden="true"
                  />
                ) : null}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface AgentChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
}

function AgentChip({ label, active, onClick, icon }: AgentChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-background text-foreground hover:bg-muted",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
