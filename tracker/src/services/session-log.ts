import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";

export function sessionLogTopic(sessionId: number | string): string {
  const id = String(sessionId).trim();
  if (!id) throw new Error("sessionLogTopic requires a session id");
  return `session_log:${id}`;
}

/** Legacy per-issue topic kept only when no numeric session id is available. */
export function sessionLogIssueTopic(projectSlug: string, issueIdentifier: string): string {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");
  return `session_log:${slug}:${identifier}`;
}
