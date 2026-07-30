import {
  BookOpen,
  CircleDot,
  FilePlus2,
  GitCompareArrows,
  Layers3,
  Plus,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  type ComposerActionContext,
  type ComposerActionHandlers,
  type ComposerActionId,
  visibleComposerActions,
} from "@/components/assistant/composerActions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ComposerAddMenuProps {
  context: ComposerActionContext;
  handlers: ComposerActionHandlers;
  disabled?: boolean;
}

const ACTION_ICONS: Record<ComposerActionId, LucideIcon> = {
  files: FilePlus2,
  context: Layers3,
  diff: GitCompareArrows,
  kb: BookOpen,
  magic: Sparkles,
  goal: CircleDot,
  commands: WandSparkles,
};

export function ComposerAddMenu({
  context,
  handlers,
  disabled = false,
}: ComposerAddMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          aria-label={t("assistant.composer.add")}
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {visibleComposerActions(context).map((id) => {
          const Icon = ACTION_ICONS[id];
          const goalUnavailable = id === "goal" && !context.supportsGoal;
          return (
            <DropdownMenuItem
              key={id}
              disabled={goalUnavailable}
              onSelect={handlers[id]}
              className="gap-2"
            >
              <Icon className="h-4 w-4" />
              {t(`assistant.composer.actions.${id}`)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
