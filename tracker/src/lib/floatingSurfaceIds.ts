export type FloatingSurfaceKind =
  | "dev-server-output"
  | "issue-terminal"
  | "project-terminal"
  | "minibrowser";

export type FloatingSurfaceOpenInput =
  | {
      kind: "dev-server-output";
      projectSlug: string;
      issueIdentifier: string;
      serverId: number;
      serverSlug: string;
      title?: string;
    }
  | {
      kind: "issue-terminal";
      projectSlug: string;
      issueIdentifier: string;
      title?: string;
    }
  | {
      kind: "project-terminal";
      projectSlug: string;
      tabId: string;
      title?: string;
    }
  | {
      kind: "minibrowser";
      projectSlug: string;
      issueIdentifier: string;
      serverId: number;
      homeUrl: string;
      title?: string;
    };

function requireNonEmpty(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be a non-empty string`);
  return trimmed;
}

export function buildFloatingSurfaceId(input: FloatingSurfaceOpenInput): string {
  const projectSlug = requireNonEmpty("projectSlug", input.projectSlug);
  switch (input.kind) {
    case "dev-server-output":
      if (!Number.isInteger(input.serverId) || input.serverId <= 0) {
        throw new Error("serverId must be a positive integer");
      }
      return `dev-server-output:${projectSlug}:${requireNonEmpty("issueIdentifier", input.issueIdentifier)}:${input.serverId}`;
    case "issue-terminal":
      return `issue-terminal:${projectSlug}:${requireNonEmpty("issueIdentifier", input.issueIdentifier)}`;
    case "project-terminal":
      return `project-terminal:${projectSlug}:${requireNonEmpty("tabId", input.tabId)}`;
    case "minibrowser":
      if (!Number.isInteger(input.serverId) || input.serverId <= 0) {
        throw new Error("serverId must be a positive integer");
      }
      return `minibrowser:${projectSlug}:${requireNonEmpty("issueIdentifier", input.issueIdentifier)}:${input.serverId}`;
  }
}
