import { Bot, ChevronDown, Compass, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={t("layout.assistantMenu.optionsAria")}>
          <Bot className="h-4 w-4" />
          {t("assistant.panel.openButton")}
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to={newIssueAssistantPath(projectSlug)}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t("layout.assistantMenu.createIssue")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={projectExploreAssistantPath(projectSlug)}>
            <Compass className="mr-2 h-4 w-4" />
            {t("layout.sessionSubtitle.explore")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
