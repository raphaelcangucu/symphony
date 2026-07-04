import { Sparkles, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { SlashCommandDef } from "@/components/assistant/slashCommands";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface ComposerCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: SlashCommandDef[];
  onSelect: (command: SlashCommandDef) => void;
}

interface CommandCategoryGroup {
  id: string;
  heading: string;
  items: SlashCommandDef[];
}

/**
 * Jean-style Magic command palette: a centered, searchable modal that groups the
 * composer's slash commands by category instead of dumping them into the inline
 * `/` dropdown. Selecting a command hands it back to the composer for insertion.
 */
export function ComposerCommandPalette({
  open,
  onOpenChange,
  commands,
  onSelect,
}: ComposerCommandPaletteProps) {
  const { t } = useTranslation();

  const groups = useMemo(() => groupByCategory(commands, t), [commands, t]);

  function handleSelect(command: SlashCommandDef) {
    onSelect(command);
    onOpenChange(false);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label={t("commands.magic.title")} size="lg">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>{t("commands.magic.button")}</span>
        </div>
        <button
          type="button"
          aria-label={t("commands.magic.close")}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <CommandInput placeholder={t("commands.magic.searchPlaceholder")} />
      <CommandList className="[&_[cmdk-list-sizer]]:grid [&_[cmdk-list-sizer]]:grid-cols-1 [&_[cmdk-list-sizer]]:items-start [&_[cmdk-list-sizer]]:gap-x-4 sm:[&_[cmdk-list-sizer]]:grid-cols-2">
        <CommandEmpty className="col-span-full">{t("commands.magic.empty")}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.heading} className="break-inside-avoid">
            {group.items.map((command) => (
              <CommandItem
                key={command.name}
                value={commandSearchValue(command)}
                onSelect={() => handleSelect(command)}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-mono text-xs font-semibold">{command.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{command.description}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

function groupByCategory(commands: SlashCommandDef[], t: TFunction): CommandCategoryGroup[] {
  const grouped = new Map<string, CommandCategoryGroup>();

  for (const command of commands) {
    const rawCategory = normalizeNonBlank(command.category);
    const id = rawCategory ? rawCategory.toLocaleLowerCase() : "__uncategorized__";
    const heading = categoryHeading(rawCategory, t);
    const group = grouped.get(id) ?? { id, heading, items: [] };
    group.items.push(command);
    grouped.set(id, group);
  }

  return [...grouped.values()];
}

function categoryHeading(category: string | null, t: TFunction): string {
  if (!category) return t("commands.magic.uncategorized");

  const key = `commands.magic.categories.${category.toLocaleLowerCase()}`;
  const translated = t(key);
  return translated === key ? titleCase(category) : translated;
}

function commandSearchValue(command: SlashCommandDef): string {
  return `${command.name} ${command.description}`.trim();
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter((entry) => entry.length > 0)
    .map((entry) => entry[0].toUpperCase() + entry.slice(1))
    .join(" ");
}

function normalizeNonBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
