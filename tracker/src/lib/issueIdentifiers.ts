export function normalizeIssueIdentifier(identifier: string | null | undefined): string {
  const trimmed = identifier?.trim() ?? "";
  if (!trimmed.startsWith("#")) return trimmed;
  return trimmed.slice(1).trim();
}
