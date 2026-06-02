import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";

export function ProjectExploreAssistantRoute() {
  const { projectSlug, view } = useWorkspace();
  return <ProjectAssistantPanel projectSlug={projectSlug} view={view} mode="page" assistantMode="explore" />;
}
