import { PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ExecutionModeMenu } from "@/components/issues/issue-detail/ExecutionModeMenu";
import { AGENT_ICONS, AGENT_KINDS, agentKindLabel, AgentChip } from "@/components/shared/AgentChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { createIssueSession, issueSessionStartErrorMessage } from "@/lib/createIssueSession";
import { DEFAULT_EXECUTION_MODE } from "@/lib/executionMode";
import { projectSessionPath, type WorkspaceView } from "@/lib/workspaceRoutes";
import type { AgentKind, ExecutionMode } from "@/types/issue";
import type { AssistantThread } from "@/types/assistant-thread";

export type WorkspaceTarget = "issue" | "parent" | "isolated";

export interface StartIssueSessionDialogIssue {
  identifier: string;
  title: string;
  agentKind: AgentKind | null;
  parentIdentifier?: string | null;
}

interface StartIssueSessionDialogProps {
  projectSlug: string;
  issue: StartIssueSessionDialogIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view?: WorkspaceView;
  /** When true, navigate to the project sessions page after creating the thread. */
  navigateToProjectSession?: boolean;
  onCreated?: (thread: AssistantThread) => void;
}

function resolveDefaultAgent(issue: StartIssueSessionDialogIssue): AgentKind {
  return issue.agentKind ?? "codex";
}

export function StartIssueSessionDialog({
  projectSlug,
  issue,
  open,
  onOpenChange,
  view = "board",
  navigateToProjectSession = false,
  onCreated,
}: StartIssueSessionDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_EXECUTION_MODE);
  const [agent, setAgent] = useState<AgentKind>("codex");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceTarget>("issue");
  const [starting, setStarting] = useState(false);
  const initializedForRef = useRef<string | null>(null);

  const parentIdentifier = issue?.parentIdentifier?.trim() || null;
  const hasParent = Boolean(parentIdentifier);

  useEffect(() => {
    if (!open) {
      initializedForRef.current = null;
      return;
    }
    if (!issue) return;

    const resetKey = `${issue.identifier}:${parentIdentifier ?? ""}`;
    if (initializedForRef.current === resetKey) return;

    initializedForRef.current = resetKey;
    setMode(DEFAULT_EXECUTION_MODE);
    setAgent(resolveDefaultAgent(issue));
    setTitle("");
    setInstructions("");
    setWorkspaceTarget("issue");
    setStarting(false);
  }, [open, issue?.identifier, issue?.agentKind, parentIdentifier]);

  useEffect(() => {
    if (!hasParent && workspaceTarget === "parent") {
      setWorkspaceTarget("issue");
    }
  }, [hasParent, workspaceTarget]);

  async function handleStart() {
    if (!issue || starting) return;
    setStarting(true);
    try {
      const thread = await createIssueSession(
        projectSlug,
        issue.identifier,
        {
          mode,
          agent,
          title: title.trim() || t("issue.sessions.defaultSessionTitle"),
          instructions: instructions.trim() || null,
          isolatedWorkspace: workspaceTarget === "isolated",
          useParentWorkspace: workspaceTarget === "parent",
        },
        t,
      );
      onOpenChange(false);
      onCreated?.(thread);
      if (navigateToProjectSession && issue) {
        navigate(projectSessionPath(projectSlug, thread.id));
      }
    } catch (cause) {
      toast.error(issueSessionStartErrorMessage(cause, t, issue.identifier));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("issueSession.dialog.title")}</DialogTitle>
          <DialogDescription>
            {issue
              ? t("issueSession.dialog.description", { identifier: issue.identifier, title: issue.title })
              : t("issueSession.dialog.descriptionFallback")}
          </DialogDescription>
        </DialogHeader>

        {issue ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="issue-session-title" className="text-xs font-medium text-muted-foreground">
                {t("issueSession.dialog.titleLabel")}
              </label>
              <input
                id="issue-session-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("issue.sessions.defaultSessionTitle")}
                disabled={starting}
                className="h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none ring-0 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
              />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{t("issueSession.dialog.agentLabel")}</span>
              <div className="flex flex-wrap gap-1.5">
                {AGENT_KINDS.map((kind) => {
                  const Icon = AGENT_ICONS[kind];
                  return (
                    <AgentChip
                      key={kind}
                      label={agentKindLabel(kind, t)}
                      icon={Icon ? <Icon className="h-3.5 w-3.5" /> : undefined}
                      active={agent === kind}
                      disabled={starting}
                      onClick={() => setAgent(kind)}
                    />
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{t("issueSession.dialog.modeLabel")}</span>
              <div>
                <ExecutionModeMenu agent={agent} mode={mode} disabled={starting} onChange={setMode} />
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t("workspacesPage.newSession.workspaceTargetLabel")}
              </span>
              <div className="space-y-2" role="radiogroup" aria-label={t("workspacesPage.newSession.workspaceTargetLabel")}>
                <WorkspaceTargetOption
                  value="issue"
                  selected={workspaceTarget}
                  disabled={starting}
                  onSelect={setWorkspaceTarget}
                  label={t("workspacesPage.newSession.issueTreeLabel", { identifier: issue.identifier })}
                  hint={t("workspacesPage.newSession.issueTreeHint", { identifier: issue.identifier })}
                  testId="workspace-target-issue"
                />
                {hasParent && parentIdentifier ? (
                  <WorkspaceTargetOption
                    value="parent"
                    selected={workspaceTarget}
                    disabled={starting}
                    onSelect={setWorkspaceTarget}
                    label={t("workspacesPage.newSession.parentTreeLabel", { identifier: parentIdentifier })}
                    hint={t("workspacesPage.newSession.parentTreeHint")}
                    testId="workspace-target-parent"
                  />
                ) : null}
                <WorkspaceTargetOption
                  value="isolated"
                  selected={workspaceTarget}
                  disabled={starting}
                  onSelect={setWorkspaceTarget}
                  label={t("workspacesPage.newSession.isolatedLabel")}
                  hint={t("workspacesPage.newSession.isolatedHint")}
                  testId="workspace-target-isolated"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="issue-session-instructions" className="text-xs font-medium text-muted-foreground">
                {t("issueSession.dialog.instructionsLabel")}
              </label>
              <Textarea
                id="issue-session-instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder={t("issueSession.dialog.instructionsPlaceholder")}
                rows={4}
                disabled={starting}
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" size="sm" disabled={starting}>
              {t("issueSession.dialog.cancel")}
            </Button>
          </DialogClose>
          <Button type="button" size="sm" disabled={!issue || starting} onClick={() => void handleStart()}>
            <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
            {starting ? t("issueSession.dialog.starting") : t("issueSession.dialog.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceTargetOption({
  value,
  selected,
  disabled,
  onSelect,
  label,
  hint,
  testId,
}: {
  value: WorkspaceTarget;
  selected: WorkspaceTarget;
  disabled: boolean;
  onSelect: (value: WorkspaceTarget) => void;
  label: string;
  hint: string;
  testId: string;
}) {
  const active = selected === value;
  return (
    <label
      data-testid={testId}
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${
        active ? "border-primary/50 bg-primary/5" : "border-border/70"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input
        type="radio"
        className="mt-0.5 h-4 w-4 accent-primary"
        name="workspace-target"
        value={value}
        checked={active}
        disabled={disabled}
        onChange={() => onSelect(value)}
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
