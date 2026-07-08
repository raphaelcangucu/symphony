export type DiffReviewSide = "additions" | "deletions";

/** One line-anchored review comment on the workspace diff. */
export interface DiffReviewComment {
  id: string;
  /** Repo-prefixed path as shown in the diff modal (e.g. `backend/src/auth.ts`). */
  filePath: string;
  side: DiffReviewSide;
  lineNumber: number;
  /** The code line the comment is anchored to, for a robust agent prompt. */
  lineText: string | null;
  comment: string;
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

/**
 * Serializes collected diff comments into one agent-facing review prompt.
 * The prompt is written in English (canonical agent language) and groups
 * comments by file in a stable order.
 */
export function buildDiffReviewPrompt(comments: readonly DiffReviewComment[]): string {
  const byFile = new Map<string, DiffReviewComment[]>();
  for (const comment of comments) {
    const list = byFile.get(comment.filePath) ?? [];
    list.push(comment);
    byFile.set(comment.filePath, list);
  }

  const sections = [...byFile.entries()].map(([filePath, fileComments]) => {
    const items = fileComments
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
    return `### ${filePath}\n${items}`;
  });

  return [
    "I reviewed the current working-tree diff and left line comments. Address each one:",
    "",
    ...sections,
  ].join("\n");
}
