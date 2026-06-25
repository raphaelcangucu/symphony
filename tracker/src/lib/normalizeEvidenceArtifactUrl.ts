const ARTIFACTS_MARKER = "/artifacts/";

/** Ensures each path segment after `/artifacts/` is URL-encoded for fetch/render. */
export function normalizeEvidenceArtifactUrl(src: string): string {
  if (!src.trim()) return src;

  try {
    const hasProtocol = /^https?:\/\//i.test(src);
    const url = new URL(src, hasProtocol ? undefined : "http://symphony.local");
    const idx = url.pathname.indexOf(ARTIFACTS_MARKER);
    if (idx === -1) return src;

    const prefix = url.pathname.slice(0, idx + ARTIFACTS_MARKER.length);
    const relative = url.pathname.slice(idx + ARTIFACTS_MARKER.length);
    const encodedRelative = relative
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(safeDecode(segment)))
      .join("/");

    url.pathname = `${prefix}${encodedRelative}`;

    if (hasProtocol) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return src;
  }
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
