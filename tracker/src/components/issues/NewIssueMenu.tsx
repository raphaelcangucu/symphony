import { ChevronDown, Plus } from "lucide-react";
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

interface NewIssueMenuProps {
  projectSlug: string;
  status?: WorkflowStatusName;
  statuses?: readonly WorkflowStatusName[];
  onCreated?: (issue: Issue) => void;
  size?: "sm" | "default";
  className?: string;
}

export function NewIssueMenu({
  projectSlug,
  status,
  statuses,
  onCreated,
  size = "sm",
  className,
}: NewIssueMenuProps) {
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  return (
    <>
      <div className={cn("inline-flex items-center", className)}>
        <Button size={size} className="rounded-r-none border-r border-primary-foreground/20" asChild>
          <Link to={newIssueAssistantPath(projectSlug)}>
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
      <IssueCreateDialog
        projectSlug={projectSlug}
        defaultStatus={status}
        statuses={statuses}
        onCreated={onCreated}
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
      />
    </>
  );
}
