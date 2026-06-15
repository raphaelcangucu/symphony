import { splitWorkflowMarkdown } from "@/lib/workflowMarkdown";

export interface WorkflowTrackerConfig {
  activeStates: string[];
  dispatchStates: string[];
  waitStates: string[];
  terminalStates: string[];
  reworkTarget: string | null;
}

const REWORK_FALLBACKS = ["Em andamento", "In Progress", "Rework"] as const;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlListValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    const inner = trimmed.replace(/^\[/, "").replace(/\]$/, "");
    if (!inner.trim()) return [];
    return inner.split(",").map((part) => stripQuotes(part.trim())).filter(Boolean);
  }

  const dashItems = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => stripQuotes(line.slice(2).trim()))
    .filter(Boolean);

  if (dashItems.length > 0) return dashItems;

  return [stripQuotes(trimmed)].filter(Boolean);
}

function parseTrackerSection(frontMatter: string): Record<string, string[]> {
  const lines = frontMatter.split(/\r?\n/);
  const trackerStart = lines.findIndex((line) => /^tracker:\s*$/.test(line));
  if (trackerStart === -1) return {};

  const entries: Record<string, string[]> = {};
  let currentKey: string | null = null;
  let bracketBuffer: string[] = [];

  for (let index = trackerStart + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\S/.test(line) && !line.startsWith(" ")) break;

    const keyMatch = line.match(/^\s{2}([a-z_]+):\s*(.*)$/);
    if (keyMatch) {
      if (currentKey && bracketBuffer.length > 0) {
        entries[currentKey] = parseYamlListValue(bracketBuffer.join("\n"));
        bracketBuffer = [];
      }

      currentKey = keyMatch[1] ?? null;
      const inline = keyMatch[2] ?? "";
      if (!currentKey) continue;

      if (inline.trim()) {
        entries[currentKey] = parseYamlListValue(inline);
        currentKey = null;
      }
      continue;
    }

    if (currentKey) {
      bracketBuffer.push(line.trim());
    }
  }

  if (currentKey && bracketBuffer.length > 0) {
    entries[currentKey] = parseYamlListValue(bracketBuffer.join("\n"));
  }

  return entries;
}

function inferReworkTarget(activeStates: string[], dispatchStates: string[]): string | null {
  const dispatch = new Set(dispatchStates);
  const firstWorkState = activeStates.find((state) => !dispatch.has(state));
  if (firstWorkState) return firstWorkState;

  for (const fallback of REWORK_FALLBACKS) {
    if (activeStates.includes(fallback)) return fallback;
  }

  return activeStates[0] ?? dispatchStates[0] ?? null;
}

export function parseWorkflowTrackerConfig(workflowMarkdown: string | null | undefined): WorkflowTrackerConfig {
  const { frontMatter } = splitWorkflowMarkdown(workflowMarkdown ?? "");
  const tracker = parseTrackerSection(frontMatter);

  const activeStates = tracker.active_states ?? [];
  const dispatchStates = tracker.dispatch_states ?? [];
  const reworkFromYaml = tracker.rework_target?.[0] ?? null;

  return {
    activeStates,
    dispatchStates,
    waitStates: tracker.wait_states ?? [],
    terminalStates: tracker.terminal_states ?? [],
    reworkTarget: reworkFromYaml ?? inferReworkTarget(activeStates, dispatchStates),
  };
}

export function normalizeWorkflowStatusName(value: string): string {
  return value.trim().toLowerCase();
}

export function isWaitState(status: string, config: WorkflowTrackerConfig): boolean {
  const normalized = normalizeWorkflowStatusName(status);
  return config.waitStates.some((candidate) => normalizeWorkflowStatusName(candidate) === normalized);
}
