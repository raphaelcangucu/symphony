import type { TFunction } from "i18next";

import type { SlashCommandDef } from "@/components/assistant/slashCommands";
import type { PromptTemplate } from "@/types/prompt-template";

export interface MagicPaletteCategoryGroup<T> {
  id: string;
  heading: string;
  items: T[];
}

export function categoryHeading(category: string | null, t: TFunction): string {
  if (!category) return t("commands.magic.uncategorized");

  const key = `commands.magic.categories.${category.toLocaleLowerCase()}`;
  const translated = t(key);
  return translated === key ? titleCase(category) : translated;
}

export function groupSlashCommands(
  commands: SlashCommandDef[],
  t: TFunction,
): MagicPaletteCategoryGroup<SlashCommandDef>[] {
  const grouped = new Map<string, MagicPaletteCategoryGroup<SlashCommandDef>>();

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

export function groupPromptTemplates(
  commands: PromptTemplate[],
  t: TFunction,
): MagicPaletteCategoryGroup<PromptTemplate>[] {
  const grouped = new Map<string, MagicPaletteCategoryGroup<PromptTemplate>>();

  for (const command of commands) {
    const categoryValue = normalizeNonBlank(command.category);
    const id = categoryValue ? categoryValue.toLocaleLowerCase() : "__uncategorized__";
    const heading = categoryHeading(categoryValue, t);
    const group = grouped.get(id) ?? { id, heading, items: [] };
    group.items.push(command);
    grouped.set(id, group);
  }

  return [...grouped.values()];
}

export function slashCommandSearchValue(command: SlashCommandDef): string {
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
