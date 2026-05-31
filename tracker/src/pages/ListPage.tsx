import { useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useWorkspace } from "@/components/layout/WorkspaceContext";
import { ListView } from "@/components/list/ListView";
import { Skeleton } from "@/components/ui/skeleton";
import { issuePath } from "@/lib/workspaceRoutes";
import type { Issue } from "@/types/issue";

export function ListPage() {
  const { projectSlug, view, filteredIssues, loading } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  const openIssue = useCallback(
    (issue: Issue) => {
      navigate({ pathname: issuePath(projectSlug, view, issue.identifier), search: location.search });
    },
    [navigate, projectSlug, view, location.search],
  );

  return (
    <>
      <div className="p-6">
        {loading ? <Skeleton className="h-72" /> : null}
        {!loading ? <ListView issues={filteredIssues} onSelectIssue={openIssue} /> : null}
      </div>
      <Outlet />
    </>
  );
}
