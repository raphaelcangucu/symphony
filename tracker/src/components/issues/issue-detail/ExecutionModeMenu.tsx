import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { availableModesFor, EXECUTION_MODES, executionModeMeta } from "@/lib/executionMode";
import type { AgentKind, ExecutionMode } from "@/types/issue";

interface ExecutionModeMenuProps {
  agent: AgentKind;
  mode: ExecutionMode;
  disabled?: boolean;
  onChange: (mode: ExecutionMode) => void;
}

export function ExecutionModeMenu({ agent, mode, disabled, onChange }: ExecutionModeMenuProps) {
  const { t } = useTranslation();
  const available = availableModesFor(agent);
  const current = executionModeMeta(available.includes(mode) ? mode : available[0]);
  const CurrentIcon = current.Icon;
  const options = EXECUTION_MODES.filter((option) => available.includes(option.id));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs"
          disabled={disabled}
          title={t(current.descKey)}
        >
          <CurrentIcon className="h-3.5 w-3.5" data-testid={`execution-mode-icon-${current.id}`} />
          {t(current.labelKey)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("issue.agent.executionMode.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current.id} onValueChange={(value) => onChange(value as ExecutionMode)}>
          {options.map((option) => {
            const OptionIcon = option.Icon;
            return (
              <DropdownMenuRadioItem key={option.id} value={option.id} className="gap-2">
                <OptionIcon
                  className="h-3.5 w-3.5 shrink-0"
                  data-testid={`execution-mode-option-icon-${option.id}`}
                />
                <span className="flex flex-col">
                  <span>{t(option.labelKey)}</span>
                  <span className="text-[11px] text-muted-foreground">{t(option.descKey)}</span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
