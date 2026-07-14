function formatYamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value === "" || /[:#\[\]{}&*!|>'"%@`]/.test(value) || /^\s/.test(value) || value.includes("\n")) {
      return JSON.stringify(value);
    }
    return value;
  }
  return JSON.stringify(value);
}

/**
 * Serializes KB frontmatter and body into the on-disk Markdown format.
 */
export function serializeKbPageMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const entries = Object.entries(frontmatter).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return body;

  const yaml = entries.map(([key, value]) => `${key}: ${formatYamlScalar(value)}`).join("\n");
  return `---\n${yaml}\n---\n${body}`;
}

export function kbPageDownloadFilename(pagePath: string): string {
  const segments = pagePath.split("/").filter((segment) => segment.length > 0);
  const filename = segments.at(-1)?.trim();
  return filename && filename.endsWith(".md") ? filename : "page.md";
}
