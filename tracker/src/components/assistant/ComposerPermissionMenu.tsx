import { ChevronDown, ShieldAlert } from "lucide-react";
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
import {
  executionModeForPermission,
  type ComposerPermissionOption,
} from "@/lib/composerCapabilities";
import { executionModeMeta } from "@/lib/executionMode";
import type { ComposerPermissionLevel } from "@/types/assistant-thread";

interface ComposerPermissionMenuProps {
  value: ComposerPermissionLevel;
  options: readonly ComposerPermissionOption[];
  disabled?: boolean;
  onChange: (value: ComposerPermissionLevel) => void;
}

export function ComposerPermissionMenu({
  value,
  options,
  disabled = false,
  onChange,
}: ComposerPermissionMenuProps) {
  const { t } = useTranslation();
  const current = executionModeMeta(executionModeForPermission(value));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 rounded-full px-2 text-xs"
          disabled={disabled}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          {t(current.labelKey)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>
          {t("assistant.composer.permissionTitle")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) =>
            onChange(next as ComposerPermissionLevel)
          }
        >
          {options.map((option) => {
            const meta = executionModeMeta(
              executionModeForPermission(option.id),
            );
            return (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                disabled={!option.available}
                className="items-start"
              >
                <span className="flex min-w-0 flex-col">
                  <span>{t(meta.labelKey)}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.available
                      ? t(meta.descKey)
                      : option.unavailableReason}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
