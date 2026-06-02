export function sessionLogTopic(projectSlug: string, issueIdentifier: string): string {
  if (!projectSlug.trim()) throw new Error("projectSlug is required");
  if (!issueIdentifier.trim()) throw new Error("issueIdentifier is required");
  return `session_log:${projectSlug}:${issueIdentifier}`;
}
