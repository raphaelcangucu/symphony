import { useEffect, useState } from "react";

import { AssistantKbDocumentsPanel } from "@/components/assistant/AssistantKbDocumentsPanel";
import { ProjectAssistantPanel } from "@/components/assistant/ProjectAssistantPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { consumeProjectAssistantHandoff } from "@/lib/previewAssistantHandoff";

export function ProjectAssistantRoute() {
  const { projectSlug, view } = useWorkspace();
  const [composerSeedMessage, setComposerSeedMessage] = useState<string | null>(null);
  const [kbDocumentReferences, setKbDocumentReferences] = useState<string[]>([]);
  const [requestedKbPath, setRequestedKbPath] = useState<string | null>(null);

  // One-shot: when the user clicks "Preparar ambiente" we stash a project
  // handoff and navigate here. Consume it and seed the composer with the
  // warm-up bootstrap prompt so the assistant runs manage_dev_env { warm_up }.
  useEffect(() => {
    if (!projectSlug) return;
    const handoff = consumeProjectAssistantHandoff(projectSlug);
    if (!handoff) return;
    setComposerSeedMessage(handoff.message);
  }, [projectSlug]);

  const assistantPanel = (
    <ProjectAssistantPanel
      projectSlug={projectSlug}
      view={view}
      mode="page"
      onKbDocumentReferencesChanged={setKbDocumentReferences}
      onOpenDocumentPath={setRequestedKbPath}
      composerSeedMessage={composerSeedMessage}
    />
  );
  const hasKbPanel = kbDocumentReferences.length > 0;

  return (
    <main
      className={
        hasKbPanel
          ? "grid h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] grid-cols-1 gap-5 overflow-hidden bg-gradient-to-br from-muted/40 via-background to-muted/20 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.82fr)] xl:grid-rows-1"
          : "h-[calc(100vh-4rem)] overflow-hidden"
      }
    >
      <section
        className={
          hasKbPanel
            ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm"
            : "h-full min-h-0 overflow-hidden"
        }
      >
        {assistantPanel}
      </section>

      {hasKbPanel ? (
        <aside className="min-h-0 min-w-0 overflow-hidden">
          <AssistantKbDocumentsPanel
            projectSlug={projectSlug}
            citedPaths={kbDocumentReferences}
            requestedPath={requestedKbPath}
          />
        </aside>
      ) : null}
    </main>
  );
}
