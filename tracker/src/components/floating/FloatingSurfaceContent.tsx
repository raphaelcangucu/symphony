import { useTranslation } from "react-i18next";

import { MinibrowserChrome } from "@/components/sessions/MinibrowserChrome";
import { ProjectTerminalWorkspace } from "@/components/terminal/ProjectTerminalWorkspace";
import { TerminalView } from "@/components/terminal/TerminalView";
import { TerminalWorkspacePanel } from "@/components/terminal/TerminalWorkspacePanel";
import type { FloatingSurface } from "@/stores/floatingSurfaceStore";

interface FloatingSurfaceContentProps {
  surface: FloatingSurface;
}

export function FloatingSurfaceContent({ surface }: FloatingSurfaceContentProps) {
  const { t } = useTranslation();

  switch (surface.payload.kind) {
    case "dev-server-output":
      return (
        <TerminalView
          kind="dev-server"
          projectSlug={surface.payload.projectSlug}
          issueIdentifier={surface.payload.issueIdentifier}
          serverSlug={surface.payload.serverSlug}
          enabled
          ariaLabel={surface.title}
          className="h-full"
        />
      );
    case "issue-terminal":
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
          <TerminalWorkspacePanel
            projectSlug={surface.payload.projectSlug}
            issueIdentifier={surface.payload.issueIdentifier}
            variant="embedded"
          />
        </div>
      );
    case "project-terminal":
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <ProjectTerminalWorkspace projectSlug={surface.payload.projectSlug} />
        </div>
      );
    case "minibrowser":
      return (
        <MinibrowserChrome
          homeUrl={surface.payload.homeUrl}
          frameTitle={surface.title}
          className="h-full min-h-0"
        />
      );
    default:
      return (
        <div className="flex h-full min-h-0 items-center justify-center p-4 text-sm text-muted-foreground">
          {t("floatingSurface.unavailable")}
        </div>
      );
  }
}
