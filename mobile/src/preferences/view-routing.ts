export type ViewTarget =
  | {
      hostId: string;
      kind: "session";
      id: string;
      surface?: "diff" | "files" | "preview" | "terminal";
    }
  | {
      hostId: string;
      kind: "issue";
      projectSlug: string;
      identifier: string;
      pullRequest?: boolean;
    };

export function routeForView(target: ViewTarget): string {
  if (target.kind === "session") {
    const id = pathSegment(target.id);
    if (target.surface === "terminal") {
      return `/h/${pathSegment(target.hostId)}/session/${id}`;
    }
    if (target.surface) {
      return `/h/${pathSegment(target.hostId)}/${target.surface}/${id}`;
    }
    return `/h/${pathSegment(target.hostId)}/chat/${id}`;
  }

  const projectSlug = pathSegment(target.projectSlug);
  const identifier = pathSegment(target.identifier);
  return `/h/${pathSegment(target.hostId)}/tasks?projectSlug=${projectSlug}&identifier=${identifier}`;
}

function pathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("View route target must not be empty");
  return encodeURIComponent(trimmed);
}
