import type { TFunction } from "i18next";

import type { SlashCommandDef } from "@/components/assistant/slashCommands";
import type { AssistantCommand } from "@/types/assistant-command";

type BuiltinSubmitKind = Exclude<AssistantCommand["submitKind"], null>;

export function assistantCommandsToSlashDefs(commands: AssistantCommand[], t: TFunction): SlashCommandDef[] {
  return commands
    .map((command) => {
      const normalizedName = normalizeSlashName(command.slug);
      if (!normalizedName) return null;

      if (command.kind === "skill") {
        const skill = normalizedName.slice(1);
        return {
          name: normalizedName,
          kind: "message",
          description: command.description,
          insertText: t("assistant.slash.skillDirective", { skill }),
        } satisfies SlashCommandDef;
      }

      return {
        name: normalizedName,
        kind: normalizeBuiltinKind(command.submitKind),
        description: command.description,
      } satisfies SlashCommandDef;
    })
    .filter((entry): entry is SlashCommandDef => entry !== null);
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
