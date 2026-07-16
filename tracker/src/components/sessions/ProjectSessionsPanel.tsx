import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";

export function ProjectSessionsPanel({
  projectSlug,
  activeExecutionIdentifier = null,
  activeAuthoringIdentifier = null,
  activeNewIssue = false,
}: {
  projectSlug: string;
  activeExecutionIdentifier?: string | null;
  activeAuthoringIdentifier?: string | null;
  activeNewIssue?: boolean;
}) {
  return (
    <ProjectSessionsWorkspace
      projectSlug={projectSlug}
      activeExecutionIdentifier={activeExecutionIdentifier}
      activeAuthoringIdentifier={activeAuthoringIdentifier}
      activeNewIssue={activeNewIssue}
    />
  );
}
