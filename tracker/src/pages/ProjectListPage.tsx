import { Archive, FolderKanban, Plus, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectsIndexProvider, type ProjectStatusFilter } from "@/components/projects/ProjectsIndexContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { notifyTrackerProjectsChanged } from "@/lib/projectEvents";
import { projectsFiltersPath, projectsNewPath } from "@/lib/workspaceRoutes";
import { archiveProject, deleteProject, listProjects, restoreProject } from "@/services/projects";
import type { Project } from "@/types/project";

function projectMatchesStatus(project: Project, statusFilter: ProjectStatusFilter) {
  if (statusFilter === "all") return true;
  const isArchived = Boolean(project.archivedAt);
  return statusFilter === "archived" ? isArchived : !isArchived;
}

function projectMatchesKeyword(project: Project, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return true;

  return [project.name, project.slug, project.description ?? ""].join(" ").toLowerCase().includes(normalizedKeyword);
}

function parseStatusFilter(value: string | null): ProjectStatusFilter {
  return value === "archived" || value === "all" ? value : "ongoing";
}

export function ProjectListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const statusFilter = parseStatusFilter(searchParams.get("status"));
  const keyword = searchParams.get("q") ?? "";

  const setStatusFilter = (next: ProjectStatusFilter) => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === "ongoing") params.delete("status");
        else params.set("status", next);
        return params;
      },
      { replace: true },
    );
  };

  const setKeyword = (next: string) => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        const trimmed = next.trim();
        if (trimmed) params.set("q", next);
        else params.delete("q");
        return params;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    let active = true;
    setLoading(true);

    void listProjects({ includeArchived: true })
      .then((items) => {
        if (active) setProjects(items);
      })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof Error ? error.message : "Unable to load projects");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const ongoingCount = projects.filter((project) => !project.archivedAt).length;
  const archivedCount = projects.length - ongoingCount;
  const hasActiveFilters = statusFilter !== "ongoing" || keyword.trim().length > 0;
  const filteredProjects = useMemo(
    () => projects.filter((project) => projectMatchesStatus(project, statusFilter) && projectMatchesKeyword(project, keyword)),
    [keyword, projects, statusFilter],
  );

  const replaceProject = (updatedProject: Project) => {
    setProjects((current) => {
      if (current.some((project) => project.slug === updatedProject.slug)) {
        return current.map((project) => (project.slug === updatedProject.slug ? updatedProject : project));
      }
      return [...current, updatedProject];
    });
  };

  const handleProjectCreated = (project: Project) => {
    setProjects((current) => [...current, project]);
    notifyTrackerProjectsChanged();
  };

  const handleArchive = async (project: Project) => {
    try {
      const archivedProject = await archiveProject(project.slug);
      replaceProject(archivedProject);
      notifyTrackerProjectsChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to archive project");
    }
  };

  const handleRestore = async (project: Project) => {
    try {
      const restoredProject = await restoreProject(project.slug);
      replaceProject(restoredProject);
      setStatusFilter("ongoing");
      notifyTrackerProjectsChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to restore project");
    }
  };

  const handleDelete = async (project: Project) => {
    const confirmed = window.confirm(`Delete project "${project.name}" permanently? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteProject(project.slug);
      setProjects((current) => current.filter((item) => item.slug !== project.slug));
      notifyTrackerProjectsChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete project");
    }
  };

  const clearFilters = () => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete("q");
        params.delete("status");
        return params;
      },
      { replace: true },
    );
  };

  const contextValue = {
    projects,
    statusFilter,
    setStatusFilter,
    keyword,
    setKeyword,
    ongoingCount,
    archivedCount,
    hasActiveFilters,
    clearFilters,
    onProjectCreated: handleProjectCreated,
  };

  return (
    <ProjectsIndexProvider value={contextValue}>
      <div className="min-h-screen p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground">Choose a local tracker project.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate({ pathname: projectsFiltersPath(), search: location.search })}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => navigate({ pathname: projectsNewPath(), search: location.search })}
            >
              <Plus className="h-4 w-4" />
              New workspace project
            </Button>
          </div>
        </div>

        <main className="min-w-0">
          {loading ? <Skeleton className="h-40" /> : null}
          {!loading && filteredProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card/70 p-8 text-sm text-muted-foreground">
              {projects.length === 0 ? "No projects returned by the tracker API." : "No projects match your filters."}
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project) => {
              const isArchived = Boolean(project.archivedAt);

              return (
                <Card key={project.slug} className="h-full transition hover:border-primary/30 hover:shadow-md">
                  <Link className="block" to={`/projects/${project.slug}/board`}>
                    <CardHeader>
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                          <FolderKanban className="h-4 w-4" />
                        </div>
                        {isArchived ? <Badge variant="muted">Archived</Badge> : null}
                      </div>
                      <CardTitle>{project.name}</CardTitle>
                      <CardDescription>{project.description || project.slug}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">{project.issueCount ?? 0} issues</CardContent>
                  </Link>
                  <CardContent className="flex justify-end gap-1 border-t pt-3">
                    {isArchived ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          aria-label={`Restore ${project.name}`}
                          title="Restore project"
                          onClick={() => void handleRestore(project)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Delete ${project.name} permanently`}
                          title="Delete project permanently"
                          onClick={() => void handleDelete(project)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label={`Archive ${project.name}`}
                        title="Archive project"
                        onClick={() => void handleArchive(project)}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </main>
      </div>
      <Outlet />
    </ProjectsIndexProvider>
  );
}
