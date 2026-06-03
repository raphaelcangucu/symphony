import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectConfigEditor } from "@/components/projects/ProjectConfigEditor";
import { notifyTrackerProjectsChanged } from "@/lib/projectEvents";
import {
  DEFAULT_PROJECT_SETTINGS_TAB,
  PROJECTS_PATH,
  isProjectSettingsTab,
  projectSettingsPath,
  workspaceBasePath,
} from "@/lib/workspaceRoutes";
import { getProject } from "@/services/projects";
import type { Project } from "@/types/project";

export function ProjectSettingsPage() {
  const { projectSlug = "", tab } = useParams();
  const navigate = useNavigate();
  const slug = projectSlug.trim();
  const activeTab = isProjectSettingsTab(tab) ? tab : DEFAULT_PROJECT_SETTINGS_TAB;
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!slug) {
      navigate(PROJECTS_PATH, { replace: true });
      return;
    }
    let active = true;
    void getProject(slug)
      .then((loaded) => active && setProject(loaded))
      .catch((cause) => {
        if (!active) return;
        toast.error(cause instanceof Error ? cause.message : "Unable to load project");
        navigate(PROJECTS_PATH, { replace: true });
      });
    return () => {
      active = false;
    };
  }, [slug, navigate]);

  if (!project) return null;

  return (
    <div className="h-[calc(100vh-4rem)] overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
        <header className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card shadow-sm">
            <Settings2 className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project settings</p>
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <p className="text-sm text-muted-foreground">
              Per-project configuration. Process-level settings live in the server environment.
            </p>
          </div>
        </header>
      <ProjectConfigEditor
        key={project.slug}
        project={project}
        activeTab={activeTab}
        onTabChange={(next) => navigate(projectSettingsPath(project.slug, next))}
        onCancel={() => navigate(workspaceBasePath(project.slug, "board"))}
          onSaved={(updated) => {
            setProject(updated);
            notifyTrackerProjectsChanged();
            toast.success("Saved");
          }}
        />
      </div>
    </div>
  );
}
