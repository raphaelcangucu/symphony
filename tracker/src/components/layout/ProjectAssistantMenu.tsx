import { Bot, ChevronDown, Compass, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { newIssueAssistantPath, projectExploreAssistantPath } from "@/lib/workspaceRoutes";

interface ProjectAssistantMenuProps {
  projectSlug: string;
}

export function ProjectAssistantMenu({ projectSlug }: ProjectAssistantMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Assistant options">
          <Bot className="h-4 w-4" />
          Assistant
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to={newIssueAssistantPath(projectSlug)}>
            <Sparkles className="mr-2 h-4 w-4" />
            Create issue
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={projectExploreAssistantPath(projectSlug)}>
            <Compass className="mr-2 h-4 w-4" />
            Explore project
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
