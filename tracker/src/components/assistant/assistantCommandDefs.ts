import type { TFunction } from "i18next";

import type { SlashCommandDef } from "@/components/assistant/slashCommands";
import type { AssistantCommand } from "@/types/assistant-command";

type BuiltinSubmitKind = Exclude<AssistantCommand["submitKind"], null>;

export function assistantCommandsToSlashDefs(commands: AssistantCommand[], t: TFunction): SlashCommandDef[] {
  const slashDefs: SlashCommandDef[] = [];
  for (const command of commands) {
    const normalizedName = normalizeSlashName(command.slug);
    if (!normalizedName) continue;

    if (command.kind === "skill") {
      const skill = normalizedName.slice(1);
      slashDefs.push({
        name: normalizedName,
        kind: "message",
        description: command.description,
        insertText: t("assistant.slash.skillDirective", { skill }),
        category: command.category,
      });
      continue;
    }

    slashDefs.push({
      name: normalizedName,
      kind: normalizeBuiltinKind(command.submitKind),
      description: command.description,
      category: command.category,
    });
  }
  return slashDefs;
}

function normalizeBuiltinKind(submitKind: AssistantCommand["submitKind"]): BuiltinSubmitKind {
  if (submitKind === "goal" || submitKind === "infer" || submitKind === "btw" || submitKind === "message") {
    return submitKind;
  }
  return "message";
}

function normalizeSlashName(slug: string): `/${string}` | null {
  if (typeof slug !== "string") return null;
  const trimmedSlug = slug.trim().replace(/^\/+/, "");
  if (!trimmedSlug) return null;
  return `/${trimmedSlug}`;
}
