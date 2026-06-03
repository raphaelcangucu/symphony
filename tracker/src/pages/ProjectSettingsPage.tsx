import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { ProjectConfigEditor } from "@/components/projects/ProjectConfigEditor";
import { notifyTrackerProjectsChanged } from "@/lib/projectEvents";
import { PROJECTS_PATH, workspaceBasePath } from "@/lib/workspaceRoutes";
import { getProject } from "@/services/projects";
import type { Project } from "@/types/project";

export function ProjectSettingsPage() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const slug = projectSlug.trim();
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
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{project.name} &middot; settings</h1>
        <p className="text-sm text-muted-foreground">
          Per-project configuration. Process-level settings live in the server environment.
        </p>
      </header>
      <ProjectConfigEditor
        key={project.slug}
        project={project}
        onCancel={() => navigate(workspaceBasePath(project.slug, "board"))}
        onSaved={(updated) => {
          setProject(updated);
          notifyTrackerProjectsChanged();
          toast.success("Saved");
        }}
      />
    </div>
  );
}
