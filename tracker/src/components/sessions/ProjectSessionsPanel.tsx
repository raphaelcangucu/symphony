import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";

export function ProjectSessionsPanel({
  projectSlug,
  activeExecutionIdentifier = null,
  activeAuthoringIdentifier = null,
}: {
  projectSlug: string;
  activeExecutionIdentifier?: string | null;
  activeAuthoringIdentifier?: string | null;
}) {
  return (
    <ProjectSessionsWorkspace
      projectSlug={projectSlug}
      activeExecutionIdentifier={activeExecutionIdentifier}
      activeAuthoringIdentifier={activeAuthoringIdentifier}
    />
  );
}
