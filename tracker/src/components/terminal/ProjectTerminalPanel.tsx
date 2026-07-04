import { ProjectTerminalWorkspace } from "@/components/terminal/ProjectTerminalWorkspace";

export function ProjectTerminalPanel({ projectSlug }: { projectSlug: string }) {
  return <ProjectTerminalWorkspace projectSlug={projectSlug} />;
}
