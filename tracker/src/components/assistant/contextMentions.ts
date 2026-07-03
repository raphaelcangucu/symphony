export type MentionType = "issue" | "file" | "pr";
export type ComposerContextChipType =
  | MentionType
  | "doc"
  | "saved"
  | "session"
  | "security"
  | "security_alert"
  | "advisory";
export type ComposerContextChipState = "draft" | "loaded";

export interface MentionRef {
  type: MentionType;
  id: string;
}

export interface ResolvedMention extends MentionRef {
  label?: string;
  detail?: string;
}

export interface ComposerContextChipRef {
  type: ComposerContextChipType;
  id: string;
  label?: string;
  detail?: string;
  state: ComposerContextChipState;
}

const MENTION_TYPES: readonly MentionType[] = ["issue", "file", "pr"];

export const MENTION_TOKEN_RE = /@(issue|file|pr):([^\s]+)/g;

export function mentionToken(ref: MentionRef): string {
  return `@${ref.type}:${ref.id}`;
}

export function parseMentionTokens(text: string): MentionRef[] {
  if (!text) return [];

  const seen = new Set<string>();
  const refs: MentionRef[] = [];

  for (const match of text.matchAll(MENTION_TOKEN_RE)) {
    const type = match[1] as MentionType;
    const id = match[2];
    if (!MENTION_TYPES.includes(type) || !id) continue;

    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ type, id });
  }

  return refs;
}

export function expandComposerMentions(text: string, resolved: ResolvedMention[]): string {
  if (!resolved || resolved.length === 0) return text;

  const seen = new Set<string>();
  const lines: string[] = [];

  for (const entity of resolved) {
    if (!entity || !MENTION_TYPES.includes(entity.type) || !entity.id) continue;
    const key = `${entity.type}:${entity.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(contextLine(entity));
  }

  if (lines.length === 0) return text;

  return `${text}\n\n## Context\n\n${lines.join("\n")}`;
}

function contextLine(entity: ResolvedMention): string {
  switch (entity.type) {
    case "issue": {
      const head = `- Issue ${entity.id}`;
      const label = entity.label ? ` — ${entity.label}` : "";
      const detail = entity.detail ? ` (${entity.detail})` : "";
      return `${head}${label}${detail}`;
    }
    case "file":
      return `- File ${entity.id}`;
    case "pr": {
      const head = `- PR #${entity.id}`;
      const label = entity.label ? ` — ${entity.label}` : "";
      return `${head}${label}`;
    }
    default:
      return `- ${entity.id}`;
  }
}
