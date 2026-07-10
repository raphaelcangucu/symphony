export type DiffReviewSide = "additions" | "deletions";
export type DiffReviewSource = "branch" | "uncommitted" | "commit";

export interface DiffReviewComment {
  id: string;
  filePath: string;
  side: DiffReviewSide;
  lineNumber: number;
  lineText: string | null;
  comment: string;
  source: DiffReviewSource;
  commitSha?: string;
  commitRepo?: string;
}

export interface CommitNote {
  repo: string;
  sha: string;
  shortSha: string;
  message: string;
  note: string;
}

export function newDiffReviewCommentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Resolves the text of a diff line from a unified patch. `lineNumber` is the
 * new-file line number for additions/context and the old-file line number for
 * deletions, matching what the diff renderer reports on line clicks.
 */
export function lineTextFromPatch(patch: string, side: DiffReviewSide, lineNumber: number): string | null {
  if (!patch) return null;

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER_REGEX.exec(raw);
    if (header) {
      oldLine = Number.parseInt(header[1], 10);
      newLine = Number.parseInt(header[2], 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (raw.startsWith("+")) {
      if (side === "additions" && newLine === lineNumber) return raw.slice(1);
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      if (side === "deletions" && oldLine === lineNumber) return raw.slice(1);
      oldLine += 1;
      continue;
    }
    if (raw.startsWith("\\")) continue;

    // Context line: present in both versions.
    if (side === "additions" && newLine === lineNumber) return raw.slice(1);
    if (side === "deletions" && oldLine === lineNumber) return raw.slice(1);
    oldLine += 1;
    newLine += 1;
  }

  return null;
}

function lineCommentHeading(comment: DiffReviewComment): string {
  if (comment.source === "commit") {
    const repo = comment.commitRepo?.trim() || "repo";
    const short =
      comment.commitSha && comment.commitSha.length >= 7
        ? comment.commitSha.slice(0, 7)
        : comment.commitSha || "???????";
    return `### ${repo} @ ${short} — ${comment.filePath}`;
  }
  if (comment.source === "branch") return `### (branch) — ${comment.filePath}`;
  return `### (working tree) — ${comment.filePath}`;
}

function formatLineItems(fileComments: DiffReviewComment[]): string {
  return fileComments
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((comment) => {
      const location =
        comment.side === "deletions"
          ? `line ${comment.lineNumber} (removed)`
          : `line ${comment.lineNumber}`;
      const anchor = comment.lineText?.trim() ? `\n  > ${comment.lineText.trim()}` : "";
      return `- ${location}:${anchor}\n  ${comment.comment.trim().replace(/\n/g, "\n  ")}`;
    })
    .join("\n");
}

export function buildDiffReviewPrompt(
  comments: readonly DiffReviewComment[],
  notes: readonly CommitNote[] = [],
): string {
  const usableNotes = notes.filter((n) => n.note.trim().length > 0);
  const noteSection =
    usableNotes.length === 0
      ? []
      : [
          "## Commit notes",
          ...usableNotes.map((n) => {
            const short = n.shortSha || n.sha.slice(0, 7);
            return `### ${n.repo} @ ${short} — ${n.message}\n- ${n.note.trim().replace(/\n/g, "\n  ")}`;
          }),
          "",
        ];

  const byHeading = new Map<string, DiffReviewComment[]>();
  for (const comment of comments) {
    const heading = lineCommentHeading(comment);
    const list = byHeading.get(heading) ?? [];
    list.push(comment);
    byHeading.set(heading, list);
  }

  const lineSections = [...byHeading.entries()].map(
    ([heading, fileComments]) => `${heading}\n${formatLineItems(fileComments)}`,
  );

  const lineBlock =
    lineSections.length === 0 ? [] : ["## Line comments", "", ...lineSections];

  return [
    "I reviewed workspace diffs and left notes. Address each:",
    "",
    ...noteSection,
    ...lineBlock,
  ]
    .join("\n")
    .trimEnd();
}
