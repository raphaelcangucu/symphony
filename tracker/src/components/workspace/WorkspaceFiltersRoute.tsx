import { useLocation, useNavigate } from "react-router-dom";

import { BoardFiltersDrawer } from "@/components/board/BoardFiltersDrawer";
import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { workspaceBasePath } from "@/lib/workspaceRoutes";

export function WorkspaceFiltersRoute() {
  const { projectSlug, view } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  const focusSearch = Boolean((location.state as { focusSearch?: boolean } | null)?.focusSearch);

  return (
    <BoardFiltersDrawer
      open
      focusSearch={focusSearch}
      onOpenChange={(open) => {
        if (!open) navigate({ pathname: workspaceBasePath(projectSlug, view), search: location.search });
      }}
    />
  );
}
