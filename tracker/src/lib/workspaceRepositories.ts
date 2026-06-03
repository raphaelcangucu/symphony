const DEFAULT_WORKSPACE_SEGMENT = "repository";
const DEFAULT_REPOSITORY_ROLE = "service";
const DEFAULT_REPOSITORY_BRANCH = "main";

export function sanitizeWorkspaceSegment(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function defaultWorkspacePath(name: string): string {
  return sanitizeWorkspaceSegment(name) || DEFAULT_WORKSPACE_SEGMENT;
}

export function inferRole(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("front") || normalized.includes("web")) return "frontend";
  if (normalized.includes("api") || normalized.includes("back")) return "backend";
  return DEFAULT_REPOSITORY_ROLE;
}

export function repositoryNameFromFullName(fullName: string): string {
  const segment = fullName.split("/").pop();
  return segment && segment.trim().length > 0 ? segment : DEFAULT_WORKSPACE_SEGMENT;
}

export { DEFAULT_REPOSITORY_ROLE, DEFAULT_REPOSITORY_BRANCH };
