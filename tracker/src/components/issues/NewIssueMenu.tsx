import { Bot, ChevronDown, CircleDot, Plus, Sparkles, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { IssueSessionPickerDialog } from "@/components/sessions/IssueSessionPickerDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { newIssueAssistantPath, projectSessionPath, projectTerminalPath } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
import { createProjectSessionThread } from "@/services/assistantThreads";
import type { Issue } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

import { IssueCreateDialog } from "./IssueCreateDialog";

type NewIssueMenuVariant = "button" | "icon" | "dashed";

interface NewIssueMenuProps {
  projectSlug: string;
  status?: WorkflowStatusName;
  statuses?: readonly WorkflowStatusName[];
  onCreated?: (issue: Issue) => void;
  size?: "sm" | "default";
  variant?: NewIssueMenuVariant;
  className?: string;
}

export function NewIssueMenu({
  projectSlug,
  status,
  statuses,
  onCreated,
  size = "sm",
  variant = "button",
  className,
}: NewIssueMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [issueSessionPickerOpen, setIssueSessionPickerOpen] = useState(false);
  const [creatingProjectSession, setCreatingProjectSession] = useState(false);

  const assistantPath = newIssueAssistantPath(projectSlug);
  const terminalPath = projectTerminalPath(projectSlug);
  const addLabel = status ? t("issue.create.addToStatus", { status }) : t("issue.create.add");

  async function handleCreateProjectSession() {
    if (creatingProjectSession) return;
    setCreatingProjectSession(true);
    try {
      const thread = await createProjectSessionThread(projectSlug, {
        title: t("sessions.newSessionTitle"),
      });
      navigate(projectSessionPath(projectSlug, thread.id));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("sessions.createFailed"));
    } finally {
      setCreatingProjectSession(false);
    }
  }

  const renderMenuItems = (includeIssueAssistant: boolean) => (
    <DropdownMenuContent align="end" className="w-56">
      {includeIssueAssistant ? (
        <DropdownMenuItem asChild>
          <Link to={assistantPath}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("issue.create.withAssistant")}
          </Link>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        disabled={creatingProjectSession}
        onSelect={(event) => {
          event.preventDefault();
          void handleCreateProjectSession();
        }}
      >
        <Bot className="mr-2 h-4 w-4" />
        {creatingProjectSession ? t("sessions.creating") : t("issue.create.newProjectSession")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setIssueSessionPickerOpen(true)}>
        <CircleDot className="mr-2 h-4 w-4" />
        {t("issue.create.newIssueSession")}
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to={terminalPath}>
          <TerminalSquare className="mr-2 h-4 w-4" />
          {t("issue.create.newProjectTerminal")}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setQuickCreateOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        {t("issue.create.quickCreate")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  const dialog = (
    <>
      <IssueCreateDialog
        projectSlug={projectSlug}
        defaultStatus={status}
        statuses={statuses}
        onCreated={onCreated}
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
      />
      <IssueSessionPickerDialog
        projectSlug={projectSlug}
        open={issueSessionPickerOpen}
        onOpenChange={setIssueSessionPickerOpen}
      />
    </>
  );

  if (variant === "icon") {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={addLabel}
              title={t("issue.create.trigger")}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                className,
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          {renderMenuItems(true)}
        </DropdownMenu>
        {dialog}
      </>
    );
  }

  if (variant === "dashed") {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={addLabel}
              className={cn(
                "flex h-20 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground",
                className,
              )}
            >
              <Plus className="h-4 w-4" />
              {t("issue.create.add")}
            </button>
          </DropdownMenuTrigger>
          {renderMenuItems(true)}
        </DropdownMenu>
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className={cn("inline-flex items-center", className)}>
        <Button size={size} className="rounded-r-none border-r border-primary-foreground/20" asChild>
          <Link to={assistantPath}>
            <Plus className="h-4 w-4" />
            {t("issue.create.trigger")}
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size={size}
              aria-label={t("issue.create.optionsAria")}
              className="rounded-l-none px-2"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          {renderMenuItems(false)}
        </DropdownMenu>
      </div>
      {dialog}
    </>
  );
}
