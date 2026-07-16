const MARKDOWN_PATH_SUFFIX = ".md";
const DOCS_SEGMENT = "docs";
const EXTERNAL_SCHEME_RE = /^(?:https?:|mailto:)/i;
/** Matches markdown / bare / backtick-adjacent `.md` path tokens in assistant text. */
export const KB_DOCUMENT_REFERENCE_TOKEN_RE =
  /(?:file:\/\/)?[^\s()[\]<>`"']+\.md(?:#[^\s()[\]<>`"']*)?(?:\?[^\s()[\]<>`"']*)?/gi;
const REFERENCE_TOKEN_RE = KB_DOCUMENT_REFERENCE_TOKEN_RE;

export function normalizeKbDocumentReference(rawReference: string | null | undefined): string | null {
  if (!rawReference) return null;

  const withoutWrapper = rawReference.trim().replace(/^<|>$/g, "");
  if (!withoutWrapper || EXTERNAL_SCHEME_RE.test(withoutWrapper)) return null;

  const withoutFileScheme = withoutWrapper.replace(/^file:\/\//i, "");
  const withoutFragment = withoutFileScheme.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  const normalizedSlashes = withoutQuery.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalizedSlashes.toLowerCase().endsWith(MARKDOWN_PATH_SUFFIX)) return null;

  const segments = normalizedSlashes.split("/").filter(Boolean);
  const docsIndex = lastIndexOfSegment(segments, DOCS_SEGMENT);
  const pageSegments = docsIndex >= 0 ? segments.slice(docsIndex + 1) : segments;
  if (!isSafeKbPagePath(pageSegments)) return null;

  return pageSegments.join("/");
}

export function extractKbDocumentReferencesFromMarkdown(markdown: string | null | undefined): string[] {
  if (!markdown) return [];

  const references = new Set<string>();
  for (const match of markdown.matchAll(REFERENCE_TOKEN_RE)) {
    const normalized = normalizeKbDocumentReference(match[0]);
    if (normalized) references.add(normalized);
  }

  return [...references];
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
