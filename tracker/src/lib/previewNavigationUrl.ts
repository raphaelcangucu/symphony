/**
 * Resolves a preview address-bar value against the current committed URL.
 * Absolute URLs (with a scheme) are used as-is; relative paths resolve against `baseUrl`.
 * Returns null when the input is empty or not a valid URL.
 */
export function resolvePreviewNavigationUrl(input: string, baseUrl: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (!baseUrl.trim()) {
    return null;
  }

  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return new URL(trimmed).href;
    }

    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}
