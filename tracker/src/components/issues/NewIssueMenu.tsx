import { ChevronDown, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { newIssueAssistantPath } from "@/lib/workspaceRoutes";
import { cn } from "@/lib/utils";
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
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const assistantPath = newIssueAssistantPath(projectSlug);
  const addLabel = status ? `Add issue to ${status}` : "Add issue";

  const menuItems = (
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuItem asChild>
        <Link to={assistantPath}>
          <Sparkles className="mr-2 h-4 w-4" />
          New issue with assistant
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setQuickCreateOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Quick create
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  const dialog = (
    <IssueCreateDialog
      projectSlug={projectSlug}
      defaultStatus={status}
      statuses={statuses}
      onCreated={onCreated}
      open={quickCreateOpen}
      onOpenChange={setQuickCreateOpen}
    />
  );

  if (variant === "icon") {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={addLabel}
              title="New issue"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                className,
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          {menuItems}
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
              Add issue
            </button>
          </DropdownMenuTrigger>
          {menuItems}
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
            New issue
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size={size}
              aria-label="New issue options"
              className="rounded-l-none px-2"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => setQuickCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Quick create
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {dialog}
    </>
  );
}
