import { useLocation, useNavigate, useParams } from "react-router-dom";

import { DevEnvPanel } from "@/components/devenv/DevEnvPanel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PROJECTS_PATH } from "@/lib/workspaceRoutes";

export function ProjectDevEnvRoute() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const slug = projectSlug.trim();

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) navigate({ pathname: PROJECTS_PATH, search: location.search });
      }}
    >
      <SheetContent side="right" className="flex h-full w-full flex-col gap-4 overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Dev environment setup</SheetTitle>
          <SheetDescription>Propose, edit, and run setup steps before opening the project board.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto pr-1">{slug ? <DevEnvPanel projectSlug={slug} /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}
