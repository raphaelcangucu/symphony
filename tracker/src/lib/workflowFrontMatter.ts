import { AGENT_KINDS } from "@/types/issue";
import type { AgentKind } from "@/types/issue";

interface FrontMatterSplit {
  lines: string[]; // front-matter lines, without the --- fences
  body: string; // everything after the closing fence
  crlf: boolean; // true when the original document used CRLF line endings
}

function split(markdown: string): FrontMatterSplit {
  const raw = markdown ?? "";
  const crlf = raw.includes("\r\n");
  const text = crlf ? raw.replace(/\r\n/g, "\n") : raw;

  if (!text.startsWith("---")) return { lines: [], body: text, crlf };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { lines: [], body: text, crlf };

  const inner = text.slice(text.indexOf("\n") + 1, end);
  const body = text.slice(end + "\n---".length).replace(/^\n/, "");
  return { lines: inner.length > 0 ? inner.split("\n") : [], body, crlf };
}

function join(lines: string[], body: string, crlf: boolean): string {
  const fm = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "";
  const out = `${fm}${body}`;
  return crlf ? out.replace(/\n/g, "\r\n") : out;
}

/**
 * Locates the `agent:` top-level section. Returns [start, endExclusive] of its lines, or null.
 * The end index extends past blank lines so that blank-line continuation is treated as part of
 * the section (YAML blocks may be separated by blank lines within a mapping).
 */
function agentSection(lines: string[]): [number, number] | null {
  const start = lines.findIndex((line) => /^agent:\s*$/.test(line) || /^agent:\s+#/.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === "")) end += 1;
  return [start, end];
}

/**
 * Reads the `agent.kind` value from the document's front matter.
 * Returns null when the key is absent or set to an unrecognised value (inherit from project default).
 */
export function readAgentKind(markdown: string): AgentKind | null {
  const { lines } = split(markdown);
  const section = agentSection(lines);
  if (!section) return null;

  for (let i = section[0] + 1; i < section[1]; i += 1) {
    const match = lines[i].match(/^\s+kind:\s*["']?([\w-]+)["']?\s*(#.*)?$/);
    if (match) return (AGENT_KINDS as readonly string[]).includes(match[1]) ? (match[1] as AgentKind) : null;
  }
  return null;
}

/**
 * Writes (or removes) the `agent.kind` key in the document's front matter.
 * Passing null removes the key and prunes the `agent:` section entirely when kind was its only key.
 */
export function writeAgentKind(markdown: string, kind: AgentKind | null): string {
  return writeAgentStringKey(markdown, "kind", kind);
}

/**
 * Reads the `agent.model` value from the document's front matter.
 * Returns null when the key is absent or blank (inherit from user/settings default).
 */
export function readAgentModel(markdown: string): string | null {
  return readAgentStringKey(markdown, "model");
}

/**
 * Writes (or removes) the `agent.model` key in the document's front matter.
 * Passing null removes the key and prunes the `agent:` section when model was its only key.
 */
export function writeAgentModel(markdown: string, model: string | null): string {
  return writeAgentStringKey(markdown, "model", model);
}

/**
 * Reads the `agent.effort` value from the document's front matter.
 * Returns null when the key is absent or blank (inherit from user/settings default).
 */
export function readAgentEffort(markdown: string): string | null {
  return readAgentStringKey(markdown, "effort");
}

/**
 * Writes (or removes) the `agent.effort` key in the document's front matter.
 * Passing null removes the key and prunes the `agent:` section when effort was its only key.
 */
export function writeAgentEffort(markdown: string, effort: string | null): string {
  return writeAgentStringKey(markdown, "effort", effort);
}

function readAgentStringKey(markdown: string, key: string): string | null {
  const { lines } = split(markdown);
  const section = agentSection(lines);
  if (!section) return null;

  const keyPattern = new RegExp(`^\\s+${escapeRegExp(key)}:\\s*["']?([\\w.-]+)["']?\\s*(#.*)?$`);
  for (let i = section[0] + 1; i < section[1]; i += 1) {
    const match = lines[i].match(keyPattern);
    if (match) {
      const value = match[1]?.trim() ?? "";
      return value === "" ? null : value;
    }
  }
  return null;
}

function writeAgentStringKey(markdown: string, key: string, value: string | null): string {
  const { lines, body, crlf } = split(markdown);
  const section = agentSection(lines);
  const keyLine = new RegExp(`^\\s+${escapeRegExp(key)}:`);

  if (value === null) {
    if (!section) return markdown;
    const inner = lines.slice(section[0] + 1, section[1]).filter((l) => !keyLine.test(l));
    const next = [...lines.slice(0, section[0])];
    if (inner.some((l) => l.trim() !== "")) next.push(lines[section[0]], ...inner);
    next.push(...lines.slice(section[1]));
    return join(next, body, crlf);
  }

  const trimmed = value.trim();
  if (trimmed === "") return writeAgentStringKey(markdown, key, null);

  if (!section) {
    return join([...lines, "agent:", `  ${key}: ${trimmed}`], body, crlf);
  }

  const inner = lines.slice(section[0] + 1, section[1]);
  const keyIndex = inner.findIndex((l) => keyLine.test(l));
  const nextInner =
    keyIndex >= 0
      ? inner.map((l, i) => {
          if (i !== keyIndex) return l;
          const trailingComment = l.match(/#.*$/)?.[0] ?? "";
          return `  ${key}: ${trimmed}${trailingComment ? ` ${trailingComment}` : ""}`;
        })
      : [`  ${key}: ${trimmed}`, ...inner];

  const next = [...lines.slice(0, section[0]), lines[section[0]], ...nextInner, ...lines.slice(section[1])];
  return join(next, body, crlf);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
