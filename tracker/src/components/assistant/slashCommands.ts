import type { AssistantComposerSubmitKind } from "@/components/assistant/AssistantComposer";

export interface SlashCommandDef {
  name: `/${string}`;
  kind: Exclude<AssistantComposerSubmitKind, "message">;
  description: string;
}

export const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  { name: "/infer", kind: "infer", description: "Steer the running agent without waiting" },
  { name: "/btw", kind: "btw", description: "Ask a quick side question (read-only, not saved)" },
] as const;

export interface ParsedComposerInput {
  kind: AssistantComposerSubmitKind;
  argument: string;
}

export function parseSlashCommand(input: string): ParsedComposerInput {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/")) {
    return { kind: "message", argument: input.trim() };
  }

  const spaceIndex = trimmedStart.indexOf(" ");
  const token = spaceIndex === -1 ? trimmedStart : trimmedStart.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? "" : trimmedStart.slice(spaceIndex + 1);

  const command = SLASH_COMMANDS.find((entry) => entry.name === token.toLowerCase());
  if (!command) {
    return { kind: "message", argument: input.trim() };
  }

  return { kind: command.kind, argument: rest.trim() };
}

export function matchingSlashCommands(input: string): SlashCommandDef[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) return [];

  const token = (trimmed.split(" ", 1)[0] ?? "").toLowerCase();
  return SLASH_COMMANDS.filter((entry) => entry.name.startsWith(token));
}
