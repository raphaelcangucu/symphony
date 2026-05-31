import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";

export function ProjectAssistantRoute() {
  const { projectSlug, view } = useWorkspace();
  return <ProjectAssistantPanel projectSlug={projectSlug} view={view} mode="page" />;
}
