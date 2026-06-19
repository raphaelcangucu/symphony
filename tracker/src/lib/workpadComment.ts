export interface WorkpadPullRequest {
  repo: string | null;
  number: number | null;
  branch: string | null;
  base: string | null;
  url: string | null;
  status: string | null;
}

export interface WorkpadSection {
  title: string;
  body: string;
}

const SYMPHONY_PRS_BLOCK_RE = /<!--\s*symphony:prs\b[\s\S]*?-->/g;
const WORKPAD_TITLE_RE = /^##\s*Codex Workpad\b/im;

export function isWorkpadComment(body: string, kind?: string | null): boolean {
  if (kind === "workpad") return true;
  return WORKPAD_TITLE_RE.test(body.trim());
}

export function stripSymphonyPrsBlock(body: string): { displayBody: string; pullRequests: WorkpadPullRequest[] } {
  const pullRequests = [...body.matchAll(SYMPHONY_PRS_BLOCK_RE)].flatMap(([block]) => parseSymphonyPrsBlock(block));
  const displayBody = body.replace(SYMPHONY_PRS_BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim();

  return { displayBody, pullRequests };
}

export function parseWorkpadSections(body: string): WorkpadSection[] {
  const { displayBody } = stripSymphonyPrsBlock(body);
  const content = displayBody.replace(WORKPAD_TITLE_RE, "").trim();
  if (!/^###\s+/m.test(content)) return [];

  return content
    .split(/^###\s+/m)
    .filter(Boolean)
    .map((part) => {
      const newline = part.indexOf("\n");
      if (newline === -1) return { title: part.trim(), body: "" };
      return { title: part.slice(0, newline).trim(), body: part.slice(newline + 1).trim() };
    })
    .filter((section) => section.title.length > 0);
}

function parseSymphonyPrsBlock(block: string): WorkpadPullRequest[] {
  const jsonMatch = block.match(/<!--\s*symphony:prs\s+(\{[\s\S]*\})\s*-->/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]) as {
        repo?: unknown;
        prs?: Array<Record<string, unknown>>;
      };
      const defaultRepo = typeof data.repo === "string" ? data.repo : null;
      return (data.prs ?? []).map((item) =>
        normalizePullRequest({
          repo: item.repo ?? defaultRepo,
          number: item.number,
          branch: item.branch ?? item.head,
          base: item.base,
          url: item.url,
          status: item.status,
        }),
      );
    } catch {
      return [];
    }
  }

  return parseYamlPrBlock(block);
}

function parseYamlPrBlock(block: string): WorkpadPullRequest[] {
  const items: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const line of block.split("\n")) {
    if (/^\s*-\s+/.test(line)) {
      if (current) items.push(current);
      current = parseYamlKeyValue(line.replace(/^\s*-\s+/, ""));
      continue;
    }

    if (current) {
      current = { ...current, ...parseYamlKeyValue(line) };
    }
  }

  if (current) items.push(current);

  return items.map((item) =>
    normalizePullRequest({
      repo: item.repo,
      number: item.number,
      branch: item.branch,
      base: item.base,
      url: item.url,
      status: item.status,
    }),
  );
}

function parseYamlKeyValue(line: string): Record<string, string> {
  const match = line.match(/^\s*(repo|number|branch|base|url|status|head)\s*:\s*(.*?)\s*$/);
  if (!match) return {};
  return { [match[1]]: match[2] };
}

function normalizePullRequest(raw: Record<string, unknown>): WorkpadPullRequest {
  return {
    repo: stringOrNull(raw.repo),
    number: numberOrNull(raw.number),
    branch: stringOrNull(raw.branch),
    base: stringOrNull(raw.base),
    url: stringOrNull(raw.url),
    status: stringOrNull(raw.status),
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function workpadPullRequestLabel(pr: WorkpadPullRequest): string {
  if (pr.number != null && pr.repo) return `${pr.repo}#${pr.number}`;
  if (pr.number != null) return `#${pr.number}`;
  if (pr.url) return pr.url;
  return pr.repo ?? "PR";
}
