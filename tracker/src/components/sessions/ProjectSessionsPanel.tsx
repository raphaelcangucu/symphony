import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";

export function ProjectSessionsPanel({ projectSlug }: { projectSlug: string }) {
  return <ProjectSessionsWorkspace projectSlug={projectSlug} />;
}
