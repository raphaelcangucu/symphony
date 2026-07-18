import { ProjectTerminalWorkspace } from "@/components/terminal/ProjectTerminalWorkspace";

export function ProjectTerminalPanel({ projectSlug }: { projectSlug: string }) {
  return (
    <div className="h-[calc(100vh-4rem)] min-h-0">
      <ProjectTerminalWorkspace projectSlug={projectSlug} />
    </div>
  );
}
