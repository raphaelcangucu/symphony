import { useEffect, useState } from "react";

import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { consumeProjectAssistantHandoff } from "@/lib/previewAssistantHandoff";

export function ProjectAssistantRoute() {
  const { projectSlug, view } = useWorkspace();
  const [composerSeedMessage, setComposerSeedMessage] = useState<string | null>(null);

  // One-shot: when the user clicks "Preparar ambiente" we stash a project
  // handoff and navigate here. Consume it and seed the composer with the
  // warm-up bootstrap prompt so the assistant runs manage_dev_env { warm_up }.
  useEffect(() => {
    if (!projectSlug) return;
    const handoff = consumeProjectAssistantHandoff(projectSlug);
    if (!handoff) return;
    setComposerSeedMessage(handoff.message);
  }, [projectSlug]);

  return (
    <ProjectAssistantPanel
      projectSlug={projectSlug}
      view={view}
      mode="page"
      composerSeedMessage={composerSeedMessage}
    />
  );
}
