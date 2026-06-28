import type { TFunction } from "i18next";

import type { AssistantComposerSubmitKind } from "@/components/assistant/AssistantComposer";
import { i18n } from "@/i18n";
import { matchesPickerSearch } from "@/lib/pickerOptions";

export type SlashCommandContext = "authoring" | "execution";

export interface SlashCommandDef {
  name: `/${string}`;
  kind: AssistantComposerSubmitKind;
  description: string;
  /**
   * Skill commands carry guidance text inserted into the composer on selection
   * (instead of changing the submit `kind`). Built-in commands leave this unset.
   */
  insertText?: string;
}

const SLASH_COMMAND_SPECS = [
  { name: "/goal", kind: "goal", descriptionKeys: { authoring: "assistant.slash.goal", execution: "assistant.slash.goalExecution" } },
  { name: "/infer", kind: "infer", descriptionKeys: { authoring: "assistant.slash.infer", execution: "assistant.slash.infer" } },
  { name: "/btw", kind: "btw", descriptionKeys: { authoring: "assistant.slash.btw", execution: "assistant.slash.btw" } },
] as const satisfies ReadonlyArray<{
  name: `/${string}`;
  kind: Exclude<AssistantComposerSubmitKind, "message">;
  descriptionKeys: Record<SlashCommandContext, string>;
}>;

export const SLASH_COMMAND_NAMES = SLASH_COMMAND_SPECS.map((spec) => spec.name);

// Curated skills surfaced as one-shot `/`-commands in the execution composer.
// Sourced statically here as a fallback; a future `/assistant/commands` endpoint
// can supply a per-project list. Selecting one inserts its guidance directive
// rather than dispatching a typed command.
const SKILL_COMMAND_SPECS = [
  { name: "/plan", descriptionKey: "assistant.slash.skills.plan" },
  { name: "/push", descriptionKey: "assistant.slash.skills.push" },
  { name: "/pull", descriptionKey: "assistant.slash.skills.pull" },
  { name: "/land", descriptionKey: "assistant.slash.skills.land" },
  { name: "/evidence", descriptionKey: "assistant.slash.skills.evidence" },
  { name: "/workpad", descriptionKey: "assistant.slash.skills.workpad" },
  { name: "/commit", descriptionKey: "assistant.slash.skills.commit" },
  { name: "/debug", descriptionKey: "assistant.slash.skills.debug" },
] as const satisfies ReadonlyArray<{ name: `/${string}`; descriptionKey: string }>;

type Translate = TFunction;

export function defaultSkillCommands(
  t: Translate = i18n.t.bind(i18n) as Translate,
  context: SlashCommandContext = "authoring",
): SlashCommandDef[] {
  if (context !== "execution") return [];
  return SKILL_COMMAND_SPECS.map((spec) => {
    const skill = spec.name.slice(1);
    return {
      name: spec.name,
      kind: "message" as const,
      description: t(spec.descriptionKey),
      insertText: t("assistant.slash.skillDirective", { skill }),
    };
  });
}

function resolveSlashCommands(
  t: Translate = i18n.t.bind(i18n) as Translate,
  context: SlashCommandContext = "authoring",
  extras: SlashCommandDef[] = [],
): SlashCommandDef[] {
  const builtins = SLASH_COMMAND_SPECS.map((spec) => ({
    name: spec.name,
    kind: spec.kind,
    description: t(spec.descriptionKeys[context]),
  }));
  return [...builtins, ...extras];
}

function deslash(name: string): string {
  return name.replace(/^\//, "");
}

export interface ParsedComposerInput {
  kind: AssistantComposerSubmitKind;
  argument: string;
}

export function parseSlashCommand(
  input: string,
  t: Translate = i18n.t.bind(i18n) as Translate,
  context: SlashCommandContext = "authoring",
): ParsedComposerInput {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/")) {
    return { kind: "message", argument: input.trim() };
  }

  const spaceIndex = trimmedStart.indexOf(" ");
  const token = spaceIndex === -1 ? trimmedStart : trimmedStart.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? "" : trimmedStart.slice(spaceIndex + 1);

  const command = resolveSlashCommands(t, context).find((entry) => entry.name === token.toLowerCase());
  if (!command) {
    return { kind: "message", argument: input.trim() };
  }

  return { kind: command.kind, argument: rest.trim() };
}

export function matchingSlashCommands(
  input: string,
  t: Translate = i18n.t.bind(i18n) as Translate,
  context: SlashCommandContext = "authoring",
  extras?: SlashCommandDef[],
): SlashCommandDef[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return [];

  const token = (trimmed.split(" ", 1)[0] ?? "").toLowerCase();
  const term = deslash(token);
  const commands = resolveSlashCommands(t, context, extras ?? defaultSkillCommands(t, context));

  return commands
    .filter((entry) => matchesPickerSearch(term, deslash(entry.name)))
    .sort((a, b) => rankSlashMatch(a, term) - rankSlashMatch(b, term));
}

// Surface exact-prefix matches above looser substring hits, preserving the
// declared command order within each rank (Array.prototype.sort is stable).
function rankSlashMatch(entry: SlashCommandDef, term: string): number {
  return deslash(entry.name).startsWith(term) ? 0 : 1;
}
