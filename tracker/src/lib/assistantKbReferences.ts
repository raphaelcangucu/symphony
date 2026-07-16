const MARKDOWN_PATH_SUFFIX = ".md";
const DOCS_SEGMENT = "docs";
const EXTERNAL_SCHEME_RE = /^(?:https?:|mailto:)/i;
const NON_ASCII_WHITESPACE_RE = /\s/;

const CHAR_DOT = 46;
const CHAR_LOWER_M = 109;
const CHAR_UPPER_M = 77;
const CHAR_LOWER_D = 100;
const CHAR_UPPER_D = 68;
const CHAR_HASH = 35;
const CHAR_QUESTION = 63;
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_CARRIAGE_RETURN = 13;
const ASCII_LIMIT = 128;
const MARKDOWN_SUFFIX_LENGTH = MARKDOWN_PATH_SUFFIX.length;

/**
 * Token characters mirror the previous regex charset `[^\s()[\]<>`"']`: everything
 * except whitespace and these grouping/quote characters delimits a reference token.
 */
const EXCLUDED_TOKEN_CHAR_CODES = new Set<number>([
  40, // (
  41, // )
  91, // [
  93, // ]
  60, // <
  62, // >
  96, // `
  34, // "
  39, // '
]);

export interface KbDocumentReferenceMatch {
  /** The raw token as it appears in the source text. */
  raw: string;
  /** Inclusive start offset of the token within the source text. */
  start: number;
  /** Exclusive end offset of the token within the source text. */
  end: number;
}

export function normalizeKbDocumentReference(rawReference: string | null | undefined): string | null {
  if (!rawReference) return null;

  const segments = kbReferenceSegments(rawReference);
  if (!segments) return null;

  const docsIndex = lastIndexOfSegment(segments, DOCS_SEGMENT);
  const pageSegments = docsIndex >= 0 ? segments.slice(docsIndex + 1) : segments;
  if (!isSafeKbPagePath(pageSegments)) return null;

  return pageSegments.join("/");
}

/**
 * Best-effort repository hint from paths like `backend/docs/foo.md` or
 * `…/frontend/docs/foo.md`. Returns the path segment immediately before `docs/`.
 */
export function extractKbRepoHint(rawReference: string | null | undefined): string | null {
  const segments = kbReferenceSegments(rawReference);
  if (!segments) return null;

  const docsIndex = lastIndexOfSegment(segments, DOCS_SEGMENT);
  if (docsIndex <= 0) return null;

  const hint = segments[docsIndex - 1];
  return hint && hint !== "." && hint !== ".." ? hint : null;
}

/**
 * Linear-time scanner for `.md` reference tokens in assistant text.
 *
 * Replaces a greedy, backtracking regex whose `[^...]+\.md` shape degraded to
 * multi-second CPU bursts on large inputs (e.g. streamed shell output). This walks
 * each contiguous run of token characters once, so cost is O(text length) with no
 * catastrophic backtracking.
 */
export function findKbDocumentReferenceMatches(text: string | null | undefined): KbDocumentReferenceMatch[] {
  if (!text || !hasMarkdownExtensionMarker(text)) return [];

  const matches: KbDocumentReferenceMatch[] = [];
  const length = text.length;
  let index = 0;

  while (index < length) {
    if (isTokenBoundary(text, index)) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < length && !isTokenBoundary(text, index)) {
      index += 1;
    }
    const runEnd = index;

    const suffixDotIndex = lastMarkdownSuffixIndex(text, runStart, runEnd);
    if (suffixDotIndex < 0) continue;

    let end = suffixDotIndex + MARKDOWN_SUFFIX_LENGTH;
    if (end < runEnd) {
      const nextCode = text.charCodeAt(end);
      if (nextCode === CHAR_HASH || nextCode === CHAR_QUESTION) {
        end = runEnd;
      }
    }

    matches.push({ raw: text.slice(runStart, end), start: runStart, end });
  }

  return matches;
}

export function extractKbDocumentReferencesFromMarkdown(markdown: string | null | undefined): string[] {
  const matches = findKbDocumentReferenceMatches(markdown);
  if (matches.length === 0) return [];

  const references = new Set<string>();
  for (const match of matches) {
    const normalized = normalizeKbDocumentReference(match.raw);
    if (normalized) references.add(normalized);
  }

  return [...references];
}

function hasMarkdownExtensionMarker(text: string): boolean {
  const limit = text.length - MARKDOWN_SUFFIX_LENGTH;
  for (let index = 0; index <= limit; index += 1) {
    if (isMarkdownSuffixAt(text, index)) return true;
  }

  return false;
}

function lastMarkdownSuffixIndex(text: string, runStart: number, runEnd: number): number {
  // The `.` must have at least one token character before it (the old `+` quantifier),
  // and `.md` must fit inside the run. Scanning right-to-left yields the greedy match.
  for (let index = runEnd - MARKDOWN_SUFFIX_LENGTH; index >= runStart + 1; index -= 1) {
    if (isMarkdownSuffixAt(text, index)) return index;
  }

  return -1;
}

function isMarkdownSuffixAt(text: string, index: number): boolean {
  if (text.charCodeAt(index) !== CHAR_DOT) return false;

  const mCode = text.charCodeAt(index + 1);
  if (mCode !== CHAR_LOWER_M && mCode !== CHAR_UPPER_M) return false;

  const dCode = text.charCodeAt(index + 2);
  return dCode === CHAR_LOWER_D || dCode === CHAR_UPPER_D;
}

function isTokenBoundary(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  if (code === CHAR_SPACE || (code >= CHAR_TAB && code <= CHAR_CARRIAGE_RETURN)) return true;
  if (EXCLUDED_TOKEN_CHAR_CODES.has(code)) return true;
  if (code < ASCII_LIMIT) return false;

  return NON_ASCII_WHITESPACE_RE.test(text[index] ?? "");
}

function isSafeKbPagePath(segments: string[]): boolean {
  if (segments.length === 0) return false;

  return segments.every((segment) => {
    if (!segment || segment === "." || segment === "..") return false;
    return /^[a-zA-Z0-9._-]+$/.test(segment);
  });
}

function lastIndexOfSegment(segments: string[], target: string): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.toLowerCase() === target) return index;
  }

  return -1;
}

function kbReferenceSegments(rawReference: string | null | undefined): string[] | null {
  if (!rawReference) return null;

  const withoutWrapper = rawReference.trim().replace(/^<|>$/g, "");
  if (!withoutWrapper || EXTERNAL_SCHEME_RE.test(withoutWrapper)) return null;

  const withoutFileScheme = withoutWrapper.replace(/^file:\/\//i, "");
  const withoutFragment = withoutFileScheme.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  const normalizedSlashes = withoutQuery.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalizedSlashes.toLowerCase().endsWith(MARKDOWN_PATH_SUFFIX)) return null;

  return normalizedSlashes.split("/").filter(Boolean);
}
