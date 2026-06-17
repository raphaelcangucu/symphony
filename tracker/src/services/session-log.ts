import { requireNonBlank, requireProjectSlug } from "@/lib/serviceValidation";

export function sessionLogTopic(projectSlug: string, issueIdentifier: string): string {
  const slug = requireProjectSlug(projectSlug);
  const identifier = requireNonBlank(issueIdentifier, "issueIdentifier");
  return `session_log:${slug}:${identifier}`;
}
