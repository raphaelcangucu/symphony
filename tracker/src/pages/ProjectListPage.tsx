import { Archive, ExternalLink, FolderKanban, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectImportDialog } from "@/components/projects/ProjectImportDialog";
import { ProjectsIndexProvider, type ProjectStatusFilter } from "@/components/projects/ProjectsIndexContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { notifyTrackerProjectsChanged } from "@/lib/projectEvents";
import { githubProjectBoardUrl, projectTrackerLinkLabel, resolveProjectTrackerUrl } from "@/lib/projectTrackerUrl";
import { projectEditPath, projectsFiltersPath, projectsNewPath } from "@/lib/workspaceRoutes";
import { discoverGitHubProjects } from "@/services/remoteTrackers";
import { archiveProject, deleteProject, listProjects, restoreProject } from "@/services/projects";
import { importProject, importProjectFromUrl } from "@/services/projectImportExport";
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [githubBoardUrls, setGithubBoardUrls] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);

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
        if (active) toast.error(error instanceof Error ? error.message : t("project.list.toasts.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const needsGithubLookup = projects.some(
      (project) => project.tracker.kind === "github" && typeof project.tracker.config.project_id === "string",
    );
    if (!needsGithubLookup) {
      setGithubBoardUrls({});
      return undefined;
    }

    let active = true;

    void discoverGitHubProjects()
      .then((boards) => {
        if (!active) return;
        setGithubBoardUrls(Object.fromEntries(boards.map((board) => [board.id, githubProjectBoardUrl(board)])));
      })
      .catch(() => {
        if (active) setGithubBoardUrls({});
      });

    return () => {
      active = false;
    };
  }, [projects]);

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

  const handleImportFile = async (yaml: string, _fileName: string) => {
    try {
      const imported = await importProject(yaml);
      handleProjectCreated(imported);
      toast.success(t("project.list.toasts.imported", { name: imported.name }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.list.toasts.importFailed"));
      throw cause;
    }
  };

  const handleImportFromUrl = async (url: string) => {
    try {
      const imported = await importProjectFromUrl(url);
      handleProjectCreated(imported);
      toast.success(t("project.list.toasts.imported", { name: imported.name }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.list.toasts.importFailed"));
      throw cause;
    }
  };

  const handleArchive = async (project: Project) => {
    try {
      const archivedProject = await archiveProject(project.slug);
      replaceProject(archivedProject);
      notifyTrackerProjectsChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("project.list.toasts.archiveFailed"));
    }
  };

  const handleRestore = async (project: Project) => {
    try {
      const restoredProject = await restoreProject(project.slug);
      replaceProject(restoredProject);
      setStatusFilter("ongoing");
      notifyTrackerProjectsChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("project.list.toasts.restoreFailed"));
    }
  };

  const handleDelete = async (project: Project) => {
    const confirmed = window.confirm(t("project.list.deleteConfirm", { name: project.name }));
    if (!confirmed) return;

    try {
      await deleteProject(project.slug);
      setProjects((current) => current.filter((item) => item.slug !== project.slug));
      notifyTrackerProjectsChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("project.list.toasts.deleteFailed"));
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
            <h1 className="text-xl font-semibold">{t("project.list.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("project.list.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              {t("project.list.import")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate({ pathname: projectsFiltersPath(), search: location.search })}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t("project.list.filters")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => navigate({ pathname: projectsNewPath(), search: location.search })}
            >
              <Plus className="h-4 w-4" />
              {t("project.list.newWorkspace")}
            </Button>
          </div>
        </div>

        <main className="min-w-0">
          {loading ? <Skeleton className="h-40" /> : null}
          {!loading && filteredProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card/70 p-8 text-sm text-muted-foreground">
              {projects.length === 0 ? t("project.list.emptyApi") : t("project.list.emptyFiltered")}
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project) => {
              const isArchived = Boolean(project.archivedAt);
              const trackerUrl = resolveProjectTrackerUrl(project, githubBoardUrls);

              return (
                <Card key={project.slug} className="h-full transition hover:border-primary/30 hover:shadow-md">
                  <Link className="block" to={`/projects/${project.slug}/board`}>
                    <CardHeader>
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                          <FolderKanban className="h-4 w-4" />
                        </div>
                        {isArchived ? <Badge variant="muted">{t("project.list.archived")}</Badge> : null}
                      </div>
                      <CardTitle>{project.name}</CardTitle>
                      <CardDescription>{project.description || project.slug}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {t("project.list.issueCount", { count: project.issueCount ?? 0 })}
                    </CardContent>
                  </Link>
                  <CardContent className="flex justify-end gap-1 border-t pt-3">
                    {trackerUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label={projectTrackerLinkLabel(project.tracker.kind)}
                        title={projectTrackerLinkLabel(project.tracker.kind)}
                        asChild
                      >
                        <a href={trackerUrl} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label={t("project.list.editProjectAria", { name: project.name })}
                      title={t("project.list.editProject")}
                      onClick={() => navigate({ pathname: projectEditPath(project.slug), search: location.search })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {isArchived ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          aria-label={t("project.list.restoreProjectAria", { name: project.name })}
                          title={t("project.list.restoreProject")}
                          onClick={() => void handleRestore(project)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t("project.list.deletePermanentlyAria", { name: project.name })}
                          title={t("project.list.deletePermanently")}
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
                        aria-label={t("project.list.archiveProjectAria", { name: project.name })}
                        title={t("project.list.archiveProject")}
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
      <ProjectImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportFile={handleImportFile}
        onImportUrl={handleImportFromUrl}
      />
      <Outlet />
    </ProjectsIndexProvider>
  );
}
