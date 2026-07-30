import type { GitDiffFileEntry } from "@/api/contracts";

export type DiffFileGroup = {
  repo: string;
  files: GitDiffFileEntry[];
};

export type PatchLineKind = "addition" | "deletion" | "context" | "hunk" | "meta";

export type PatchLine = {
  kind: PatchLineKind;
  text: string;
};

export function groupDiffFiles(files: GitDiffFileEntry[]): DiffFileGroup[] {
  const groups = new Map<string, GitDiffFileEntry[]>();
  for (const file of files) {
    const current = groups.get(file.repo) ?? [];
    current.push(file);
    groups.set(file.repo, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repo, groupedFiles]) => ({ repo, files: groupedFiles }));
}

export function parsePatchLines(patch: string): PatchLine[] {
  if (!patch) return [];
  return patch.split("\n").map((text) => ({
    text,
    kind: patchLineKind(text),
  }));
}

function patchLineKind(line: string): PatchLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  ) {
    return "meta";
  }
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}
