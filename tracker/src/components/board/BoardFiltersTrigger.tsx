import { ListFilter } from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { countActiveFilters, filtersFromSearchParams } from "@/lib/issueFilters";
import { filtersPath, viewFromPathname, workspaceBasePath } from "@/lib/workspaceRoutes";

export function BoardFiltersTrigger() {
  const { projectSlug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const view = viewFromPathname(location.pathname);
  const isOpen = location.pathname === filtersPath(projectSlug, view);
  const activeCount = countActiveFilters(filtersFromSearchParams(searchParams));

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
