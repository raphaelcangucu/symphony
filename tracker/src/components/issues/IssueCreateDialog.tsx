import { Plus } from "lucide-react";
import type { TFunction } from "i18next";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_ICONS, agentKindLabel, AgentChip } from "@/components/shared/AgentChip";
import { useIssueFormOptions } from "@/hooks/useIssueFormOptions";
import { cn } from "@/lib/utils";
import { createIssue } from "@/services/issues";
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
  title: z.string().trim().min(1, "title_required"),
  description: z.string().optional(),
  status: z.string().trim().min(1, "status_required"),
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

function assigneeLabel(assignee: IssueAssigneeOption, t: TFunction): string {
  return assignee.login ?? assignee.name ?? t("issue.create.unknownAssignee");
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function buildAgentGoal(title: string, description: string, t: TFunction): string {
  const objective = title.trim() || t("issue.create.goal.defaultObjective");
  const details = description.trim();
  const lines = [t("issue.create.goal.objective", { objective })];

  if (details) lines.push(t("issue.create.goal.context", { details }));

  lines.push(t("issue.create.goal.constraints"));

  return lines.join("\n");
}

// Codex and Claude use "goal"; Cursor still uses prompt-only "workflow".
function longRunningModeTerm(agent: AgentKind, t: TFunction): string {
  return agent === "cursor" ? t("issue.create.terms.workflow") : t("issue.create.terms.goal");
}

function validationMessage(code: string | undefined, t: TFunction): string {
  if (code === "title_required") return t("issue.create.validation.titleRequired");
  if (code === "status_required") return t("issue.create.validation.statusRequired");
  return t("issue.create.validation.invalid");
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function concreteAgent(agent: AgentKind | ""): AgentKind | null {
  return agent === "codex" || agent === "claude" || agent === "cursor" ? agent : null;
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
  const { t } = useTranslation();
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

  const { options, loading: optionsLoading } = useIssueFormOptions(projectSlug, { enabled: open });

  const fallbackStatuses = statuses && statuses.length > 0 ? statuses : DEFAULT_WORKFLOW_STATUSES;
  const statusOptions = options.statuses.length > 0 ? options.statuses : fallbackStatuses;
  const visibleLabels = options.labels.filter((label) => !SYMPHONY_LABEL_PATTERN.test(label.name));
  const assigneeOptions = options.assignees;
  const agentOptions = options.agents;

  useEffect(() => {
    if (open) setStatus(defaultStatus);
  }, [open, defaultStatus]);

  useEffect(() => {
    if (concreteAgent(agent) === null) setCodexGoalMode(false);
  }, [agent]);

  useEffect(() => {
    if (concreteAgent(agent) !== null && codexGoalMode && !codexGoalEdited) {
      setCodexGoal(buildAgentGoal(title, description, t));
    }
  }, [agent, codexGoalEdited, codexGoalMode, description, t, title]);

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
    setCodexGoal(checked ? buildAgentGoal(title, description, t) : "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = issueFormSchema.safeParse({ title, description, status, priority: priority || undefined });
    if (!parsed.success) {
      toast.error(validationMessage(parsed.error.issues[0]?.message, t));
      return;
    }
    const goalAgent = concreteAgent(agent);
    if (goalAgent !== null && codexGoalMode && !codexGoal.trim()) {
      const term = longRunningModeTerm(goalAgent, t);
      toast.error(t("issue.create.goalModeRequired", { termCapitalized: capitalize(term), term }));
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
        goal: goalAgent !== null && codexGoalMode ? codexGoal.trim() || null : null,
      });
      onCreated?.(issue);
      resetForm();
      setOpen(false);
      toast.success(t("issue.create.created"));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("issue.create.createFailed"));
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
              {t("issue.create.trigger")}
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("issue.create.title")}</DialogTitle>
          <DialogDescription>{t("issue.create.description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("issue.create.titlePlaceholder")}
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("issue.create.descriptionPlaceholder")}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("issue.create.status")}</span>
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
              <span className="text-xs font-medium text-muted-foreground">{t("issue.create.priority")}</span>
              <Input
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                placeholder={t("issue.create.priorityPlaceholder")}
                inputMode="numeric"
              />
            </label>
          </div>

          {agentOptions.length > 0 ? (
            <div className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("issue.create.agent")}</span>
              <div className="flex flex-wrap gap-1.5">
                <AgentChip
                  label={t("issue.create.inherit", { agent: agentKindLabel(options.effectiveAgent, t) })}
                  active={agent === ""}
                  onClick={() => setAgent("")}
                />
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

          {concreteAgent(agent) !== null ? (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={codexGoalMode}
                  onChange={(event) => handleGoalModeChange(event.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                {t("issue.create.longRunningMode", {
                  termCapitalized: capitalize(longRunningModeTerm(concreteAgent(agent) as AgentKind, t)),
                })}
              </label>
              {codexGoalMode ? (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {agentKindLabel(concreteAgent(agent) as AgentKind, t)}{" "}
                    {longRunningModeTerm(concreteAgent(agent) as AgentKind, t)}
                  </span>
                  <Textarea
                    value={codexGoal}
                    onChange={(event) => {
                      setCodexGoalEdited(true);
                      setCodexGoal(event.target.value);
                    }}
                    className="min-h-28"
                    aria-label={t("issue.create.goalAria", {
                      agent: agentKindLabel(concreteAgent(agent) as AgentKind, t),
                      term: longRunningModeTerm(concreteAgent(agent) as AgentKind, t),
                    })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <ChipPicker
            title={t("issue.create.labels")}
            emptyText={optionsLoading ? t("issue.create.loadingLabels") : t("issue.create.noLabels")}
            items={visibleLabels.map((label) => ({
              value: labelValue(label),
              label: label.name,
              color: label.color,
            }))}
            selected={selectedLabels}
            onToggle={(value) => setSelectedLabels((current) => toggle(current, value))}
          />

          <ChipPicker
            title={t("issue.create.assignees")}
            emptyText={optionsLoading ? t("issue.create.loadingAssignees") : t("issue.create.noAssignees")}
            items={assigneeOptions
              .map((assignee) => ({ value: assigneeValue(assignee), label: assigneeLabel(assignee, t) }))
              .filter((item): item is { value: string; label: string } => item.value !== null)}
            selected={selectedAssignees}
            onToggle={(value) => setSelectedAssignees((current) => toggle(current, value))}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("issue.create.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("issue.create.creating") : t("issue.create.create")}
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

