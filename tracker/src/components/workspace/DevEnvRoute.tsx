import { useLocation, useNavigate } from "react-router-dom";

import { DevEnvPanel } from "@/components/devenv/DevEnvPanel";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { workspaceBasePath } from "@/lib/workspaceRoutes";

export function DevEnvRoute() {
  const { projectSlug, view } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) navigate({ pathname: workspaceBasePath(projectSlug, view), search: location.search });
      }}
    >
      <SheetContent side="right" className="flex h-full w-full flex-col gap-4 overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Dev environment setup</SheetTitle>
          <SheetDescription>Propose, edit, and run the setup steps for this workspace.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <DevEnvPanel projectSlug={projectSlug} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
