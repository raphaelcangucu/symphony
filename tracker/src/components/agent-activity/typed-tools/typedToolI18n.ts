import type { ToolFamily } from "@/lib/toolCallPresentation";

const FAMILY_I18N_KEYS: Partial<Record<ToolFamily, string>> = {
  command: "command",
  search: "search",
  preview: "preview",
  board_query: "board",
  board_action: "board",
  acceptance: "acceptance",
  evidence: "evidence",
  kb: "kb",
  devenv: "devenv",
  tunnel: "tunnel",
};

export function typedToolFamilyKey(family: string): string {
  return FAMILY_I18N_KEYS[family as ToolFamily] ?? family.replace(/_/g, " ");
}

export function typedToolFamilyLabel(
  family: string,
  translate: (key: string, fallback: string) => string,
): string {
  const key = typedToolFamilyKey(family);
  const i18nKey = `issue.toolCall.typed.families.${key}`;
  return translate(i18nKey, key);
}
