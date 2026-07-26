import type { MobileViewMode } from "./view-mode";

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

export function routeForView(mode: MobileViewMode, target: ViewTarget): string {
  if (target.kind === "session") {
    const id = pathSegment(target.id);
    if (mode === "orca") {
      return `/h/${pathSegment(target.hostId)}/session/${id}`;
    }
    const suffix = target.surface ? `/${target.surface}` : "";
    return `/codex/session/${id}${suffix}`;
  }

  const projectSlug = pathSegment(target.projectSlug);
  const identifier = pathSegment(target.identifier);
  if (mode === "orca") {
    return `/h/${pathSegment(target.hostId)}/tasks?projectSlug=${projectSlug}&identifier=${identifier}`;
  }
  return `/codex/issue/${projectSlug}/${identifier}${target.pullRequest ? "/pull-request" : ""}`;
}

function pathSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("View route target must not be empty");
  return encodeURIComponent(trimmed);
}
