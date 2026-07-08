import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";

interface MagicPaletteShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchPlaceholder: string;
  searchDisabled?: boolean;
  emptyLabel: string;
  children: ReactNode;
}

export function MagicPaletteShell({
  open,
  onOpenChange,
  searchPlaceholder,
  searchDisabled = false,
  emptyLabel,
  children,
}: MagicPaletteShellProps) {
  const { t } = useTranslation();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label={t("commands.magic.title")}>
      <CommandInput placeholder={searchPlaceholder} disabled={searchDisabled} />
      <CommandList>
        <CommandEmpty>{emptyLabel}</CommandEmpty>
        {children}
      </CommandList>
    </CommandDialog>
  );
}
