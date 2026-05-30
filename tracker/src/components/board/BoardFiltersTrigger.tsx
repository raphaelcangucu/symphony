import { ListFilter } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { filtersPath, viewFromPathname, workspaceBasePath } from "@/lib/workspaceRoutes";

const TRACKED_KEYS = ["q", "assignee", "creator"] as const;

export function BoardFiltersTrigger() {
  const { projectSlug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const view = viewFromPathname(location.pathname);
  const isOpen = location.pathname === filtersPath(projectSlug, view);
  const activeCount = TRACKED_KEYS.reduce((acc, key) => {
    const value = searchParams.get(key);
    return acc + (value && value.trim() ? 1 : 0);
  }, 0);

  const label = activeCount === 0 ? "Filters" : `Filters · ${activeCount}`;

  function toggle() {
    const target = isOpen ? workspaceBasePath(projectSlug, view) : filtersPath(projectSlug, view);
    navigate({ pathname: target, search: location.search });
  }

  return (
    <Button variant="outline" size="sm" aria-label={label} onClick={toggle}>
      <ListFilter className="h-4 w-4" />
      {label}
    </Button>
  );
}
