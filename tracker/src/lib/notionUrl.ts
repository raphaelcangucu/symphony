const NOTION_URL_PATTERN = /https:\/\/(?:www\.)?notion\.so\/\S+/gi;
const TRAILING_PUNCTUATION = /[).,\]]+$/;

/**
 * Extract Notion page/database URLs from free text.
 * Trailing punctuation commonly glued to URLs in prose is stripped.
 */
export function extractNotionUrls(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const matches = text.match(NOTION_URL_PATTERN);
  if (!matches) {
    return [];
  }

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const url = match.replace(TRAILING_PUNCTUATION, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}
