export function normalizeIssueIdentifier(identifier: string | null | undefined): string {
  const trimmed = identifier?.trim() ?? "";
  if (!trimmed.startsWith("#")) return trimmed;
  return trimmed.slice(1).trim();
}

/**
 * The identifier to show in the UI. Prefers the backend-derived
 * `displayIdentifier` (the external tracker key once an issue is reconciled),
 * falling back to the canonical `identifier` (e.g. the local `MAC-1`) while the
 * issue has no external link yet.
 */
export function issueDisplayIdentifier(issue: {
  displayIdentifier?: string | null;
  identifier: string;
}): string {
  const display = issue.displayIdentifier?.trim() ?? "";
  return display.length > 0 ? display : issue.identifier;
}
