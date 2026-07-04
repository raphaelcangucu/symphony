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
  /**
   * Grouping bucket surfaced by the Magic command palette (built-ins, workspace
   * skills, superpowers). `null`/omitted commands fall into an "uncategorized"
   * group. Server-provided commands supply their own raw category string.
   */
  category?: string | null;
}

const BUILTIN_CATEGORY = "builtin";
const SKILL_CATEGORY = "workflow";

type BuiltinSlashCommandSpec = {
  name: `/${string}`;
  kind: Exclude<AssistantComposerSubmitKind, "message">;
  category: string;
  contexts: readonly SlashCommandContext[];
  descriptionKeys: Record<SlashCommandContext, string>;
};

const SLASH_COMMAND_SPECS: readonly BuiltinSlashCommandSpec[] = [
  { name: "/goal", kind: "goal", category: BUILTIN_CATEGORY, contexts: ["authoring", "execution"], descriptionKeys: { authoring: "assistant.slash.goal", execution: "assistant.slash.goalExecution" } },
  { name: "/infer", kind: "infer", category: BUILTIN_CATEGORY, contexts: ["authoring", "execution"], descriptionKeys: { authoring: "assistant.slash.infer", execution: "assistant.slash.infer" } },
  { name: "/btw", kind: "btw", category: BUILTIN_CATEGORY, contexts: ["authoring", "execution"], descriptionKeys: { authoring: "assistant.slash.btw", execution: "assistant.slash.btw" } },
  { name: "/new-thread", kind: "new_thread", category: BUILTIN_CATEGORY, contexts: ["execution"], descriptionKeys: { authoring: "assistant.slash.newThread", execution: "assistant.slash.newThread" } },
] as const;

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
      category: SKILL_CATEGORY,
    };
  });
}

function resolveSlashCommands(
  t: Translate = i18n.t.bind(i18n) as Translate,
  context: SlashCommandContext = "authoring",
  extras: SlashCommandDef[] = [],
): SlashCommandDef[] {
  const builtins = SLASH_COMMAND_SPECS.map((spec) => ({
    ...spec,
    descriptionKey: spec.descriptionKeys[context] ?? spec.descriptionKeys.authoring ?? spec.descriptionKeys.execution,
  }))
    .filter((spec) => !spec.contexts || spec.contexts.includes(context))
    .map((spec) => ({
      name: spec.name,
      kind: spec.kind,
      description: spec.descriptionKey ? t(spec.descriptionKey) : spec.name,
      category: spec.category,
    }));
  return dedupeByName([...builtins, ...extras]);
}

// Server-provided extras can re-list the built-ins (goal/infer/btw); keep the
// first (context-aware built-in) occurrence so the palette shows each once.
function dedupeByName(commands: SlashCommandDef[]): SlashCommandDef[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = command.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Full command set (built-ins + extras) for the current context, unfiltered.
 * Powers the Magic command palette, which groups by category and filters via
 * its own search input rather than the composer's `/`-token matcher.
 */
export function allSlashCommands(
  t: Translate = i18n.t.bind(i18n) as Translate,
  context: SlashCommandContext = "authoring",
  extras?: SlashCommandDef[],
): SlashCommandDef[] {
  return resolveSlashCommands(t, context, extras ?? defaultSkillCommands(t, context));
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
