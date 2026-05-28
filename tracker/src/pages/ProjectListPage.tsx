import { Archive, FolderKanban, RotateCcw, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { BoardFiltersDrawer } from "@/components/board/BoardFiltersDrawer";
import { BoardFiltersTrigger } from "@/components/board/BoardFiltersTrigger";
import { BoardPaletteShortcuts } from "@/components/board/BoardPaletteShortcuts";
import { BoardFiltersDrawerProvider } from "@/components/board/useBoardFiltersDrawer";
import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { ListView } from "@/components/list/ListView";
import { ProjectWorkspaceWizard } from "@/components/projects/ProjectWorkspaceWizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useIssueBoard } from "@/hooks/useIssueBoard";
import { filtersFromSearchParams } from "@/lib/issueFilters";
import { cn } from "@/lib/utils";
import { notifyTrackerProjectsChanged } from "@/lib/projectEvents";
import { archiveProject, deleteProject, listProjects, restoreProject } from "@/services/projects";
import type { Issue } from "@/types/issue";
import type { Project } from "@/types/project";

type ProjectStatusFilter = "ongoing" | "archived" | "all";

const PROJECT_STATUS_FILTERS: Array<{
  id: ProjectStatusFilter;
  label: string;
  description: string;
}> = [
  { id: "ongoing", label: "Ongoing", description: "Active workspaces" },
  { id: "archived", label: "Archived", description: "Stored safely" },
  { id: "all", label: "All", description: "Everything local" },
];

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

function ProjectsIndexPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>("ongoing");
  const [keyword, setKeyword] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  return (
    <div className="min-h-screen p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">Choose a local tracker project.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </Button>
          <ProjectWorkspaceWizard onCreated={handleProjectCreated} />
        </div>
      </div>

      {filtersOpen ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            aria-label="Dismiss filters"
            onClick={() => setFiltersOpen(false)}
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
              <Button type="button" variant="ghost" size="icon" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>
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
                const filterCount = filter.id === "ongoing" ? ongoingCount : filter.id === "archived" ? archivedCount : projects.length;

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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  setKeyword("");
                  setStatusFilter("ongoing");
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </aside>
        </div>
      ) : null}

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
  );
}

export function ProjectListPage() {
  const { projectSlug } = useParams();

  if (!projectSlug) return <ProjectsIndexPage />;

  return <ProjectIssuesListPage projectSlug={projectSlug} />;
}

function ProjectIssuesListPage({ projectSlug }: { projectSlug: string }) {
  const [searchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const { issues, filteredIssues, loading, error, setIssues } = useIssueBoard(projectSlug, filters);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  const knownLogins = useMemo(() => {
    const logins = new Set<string>();
    for (const issue of issues) {
      if (issue.assignee) logins.add(issue.assignee);
      if (issue.creator) logins.add(issue.creator);
    }
    return Array.from(logins);
  }, [issues]);

  return (
    <BoardFiltersDrawerProvider>
      <div className="min-h-screen">
        <ProjectHeader
          projectSlug={projectSlug}
          onIssueCreated={(issue) => setIssues((current) => [...current, issue])}
          rightSlot={<BoardFiltersTrigger />}
        />
        <BoardFiltersDrawer knownLogins={knownLogins} />
        <BoardPaletteShortcuts />
        <div className="p-6">
          {loading ? <Skeleton className="h-72" /> : null}
          {error ? (
            <div className="mb-4 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div>
          ) : null}
          {!loading ? <ListView issues={filteredIssues} onSelectIssue={setSelectedIssue} /> : null}
        </div>
        <IssueDrawer
          projectSlug={projectSlug}
          issue={selectedIssue}
          open={selectedIssue !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedIssue(null);
          }}
        />
      </div>
    </BoardFiltersDrawerProvider>
  );
}
