import type { TFunction } from "i18next";

import type { AssistantComposerSubmitKind } from "@/components/assistant/AssistantComposer";
import { i18n } from "@/i18n";

export interface SlashCommandDef {
  name: `/${string}`;
  kind: Exclude<AssistantComposerSubmitKind, "message">;
  description: string;
}

const SLASH_COMMAND_SPECS = [
  { name: "/goal", kind: "goal", descriptionKey: "assistant.slash.goal" },
  { name: "/infer", kind: "infer", descriptionKey: "assistant.slash.infer" },
  { name: "/btw", kind: "btw", descriptionKey: "assistant.slash.btw" },
] as const satisfies ReadonlyArray<{
  name: `/${string}`;
  kind: Exclude<AssistantComposerSubmitKind, "message">;
  descriptionKey: string;
}>;

export const SLASH_COMMAND_NAMES = SLASH_COMMAND_SPECS.map((spec) => spec.name);

type Translate = TFunction;

function resolveSlashCommands(t: Translate = i18n.t.bind(i18n) as Translate): SlashCommandDef[] {
  return SLASH_COMMAND_SPECS.map((spec) => ({
    name: spec.name,
    kind: spec.kind,
    description: t(spec.descriptionKey),
  }));
}

export interface ParsedComposerInput {
  kind: AssistantComposerSubmitKind;
  argument: string;
}

export function parseSlashCommand(
  input: string,
  t: Translate = i18n.t.bind(i18n) as Translate,
): ParsedComposerInput {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/")) {
    return { kind: "message", argument: input.trim() };
  }

  const spaceIndex = trimmedStart.indexOf(" ");
  const token = spaceIndex === -1 ? trimmedStart : trimmedStart.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? "" : trimmedStart.slice(spaceIndex + 1);

  const command = resolveSlashCommands(t).find((entry) => entry.name === token.toLowerCase());
  if (!command) {
    return { kind: "message", argument: input.trim() };
  }

  return { kind: command.kind, argument: rest.trim() };
}

export function matchingSlashCommands(
  input: string,
  t: Translate = i18n.t.bind(i18n) as Translate,
): SlashCommandDef[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return [];

  const token = (trimmed.split(" ", 1)[0] ?? "").toLowerCase();
  return resolveSlashCommands(t).filter((entry) => entry.name.startsWith(token));
}
