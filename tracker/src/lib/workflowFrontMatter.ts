import type { AgentKind } from "@/types/issue";

const KINDS: readonly string[] = ["codex", "claude"];

interface FrontMatterSplit {
  lines: string[]; // front-matter lines, without the --- fences
  body: string; // everything after the closing fence
  had: boolean;
}

function split(markdown: string): FrontMatterSplit {
  const text = markdown ?? "";
  if (!text.startsWith("---")) return { lines: [], body: text, had: false };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { lines: [], body: text, had: false };

  const inner = text.slice(text.indexOf("\n") + 1, end);
  const body = text.slice(end + "\n---".length).replace(/^\n/, "");
  return { lines: inner.length > 0 ? inner.split("\n") : [], body, had: true };
}

function join(lines: string[], body: string): string {
  const fm = lines.length > 0 ? `---\n${lines.join("\n")}\n---\n` : "";
  return `${fm}${body}`;
}

/** Locates the `agent:` top-level section. Returns [start, endExclusive] of its lines, or null. */
function agentSection(lines: string[]): [number, number] | null {
  const start = lines.findIndex((line) => /^agent:\s*$/.test(line) || /^agent:\s+#/.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === "")) end += 1;
  return [start, end];
}

export function readAgentKind(markdown: string): AgentKind | null {
  const { lines } = split(markdown);
  const section = agentSection(lines);
  if (!section) return null;

  for (let i = section[0] + 1; i < section[1]; i += 1) {
    const match = lines[i].match(/^\s+kind:\s*["']?([\w-]+)["']?\s*(#.*)?$/);
    if (match) return KINDS.includes(match[1]) ? (match[1] as AgentKind) : null;
  }
  return null;
}

export function writeAgentKind(markdown: string, kind: AgentKind | null): string {
  const { lines, body } = split(markdown);
  const section = agentSection(lines);

  if (kind === null) {
    if (!section) return markdown;
    const inner = lines.slice(section[0] + 1, section[1]).filter((l) => !/^\s+kind:/.test(l));
    const next = [...lines.slice(0, section[0])];
    if (inner.some((l) => l.trim() !== "")) next.push(lines[section[0]], ...inner);
    next.push(...lines.slice(section[1]));
    return join(next, body);
  }

  if (!section) {
    return join([...lines, "agent:", `  kind: ${kind}`], body);
  }

  const inner = lines.slice(section[0] + 1, section[1]);
  const kindIndex = inner.findIndex((l) => /^\s+kind:/.test(l));
  const nextInner =
    kindIndex >= 0
      ? inner.map((l, i) => (i === kindIndex ? `  kind: ${kind}` : l))
      : [`  kind: ${kind}`, ...inner];

  const next = [...lines.slice(0, section[0]), lines[section[0]], ...nextInner, ...lines.slice(section[1])];
  return join(next, body);
}
