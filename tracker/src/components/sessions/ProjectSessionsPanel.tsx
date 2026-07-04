import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";

export function ProjectSessionsPanel({
  projectSlug,
  activeExecutionIdentifier = null,
}: {
  projectSlug: string;
  activeExecutionIdentifier?: string | null;
}) {
  return (
    <ProjectSessionsWorkspace projectSlug={projectSlug} activeExecutionIdentifier={activeExecutionIdentifier} />
  );
}
