import { Search, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useProjectsIndex, type ProjectStatusFilter } from "@/components/projects/ProjectsIndexContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PROJECTS_PATH } from "@/lib/workspaceRoutes";

const PROJECT_STATUS_FILTERS: Array<{ id: ProjectStatusFilter; label: string; description: string }> = [
  { id: "ongoing", label: "Ongoing", description: "Active workspaces" },
  { id: "archived", label: "Archived", description: "Stored safely" },
  { id: "all", label: "All", description: "Everything local" },
];

export function ProjectFiltersRoute() {
  const {
    projects,
    statusFilter,
    setStatusFilter,
    keyword,
    setKeyword,
    ongoingCount,
    archivedCount,
    hasActiveFilters,
    clearFilters,
  } = useProjectsIndex();
  const navigate = useNavigate();
  const location = useLocation();

  function close() {
    navigate({ pathname: PROJECTS_PATH, search: location.search });
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        aria-label="Dismiss filters"
        onClick={close}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-filters-title"
        className="absolute right-0 top-0 h-full w-full max-w-sm overflow-y-auto border-l bg-background p-5 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Filters</p>
            <h2 id="project-filters-title" className="mt-1 text-base font-semibold">
              Project focus
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close filters" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <label className="mb-4 block space-y-2 text-sm">
          <span className="font-medium">Keyword</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className="pl-9"
              placeholder="Search projects..."
            />
          </span>
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status</span>
            <span className="text-xs text-muted-foreground">{projects.length} total</span>
          </div>
          {PROJECT_STATUS_FILTERS.map((filter) => {
            const isSelected = statusFilter === filter.id;
            const filterCount =
              filter.id === "ongoing" ? ongoingCount : filter.id === "archived" ? archivedCount : projects.length;

            return (
              <button
                type="button"
                key={filter.id}
                aria-label={filter.label}
                aria-pressed={isSelected}
                onClick={() => setStatusFilter(filter.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                  isSelected ? "border-primary bg-primary/10 text-foreground shadow-sm" : "bg-background/60 hover:bg-muted/60",
                )}
              >
                <span>
                  <span className="block font-medium">{filter.label}</span>
                  <span className="block text-xs text-muted-foreground">{filter.description}</span>
                </span>
                <Badge variant={isSelected ? "default" : "muted"}>{filterCount}</Badge>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center justify-between font-medium text-foreground">
            <span>{ongoingCount} ongoing</span>
            <span>{archivedCount} archived</span>
          </div>
          Filters are local and instant; archived workspaces stay available until permanently deleted.
        </div>

        {hasActiveFilters ? (
          <Button type="button" variant="ghost" size="sm" className="mt-3 w-full" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </aside>
    </div>
  );
}
