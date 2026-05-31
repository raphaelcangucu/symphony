import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { EditProjectDialog } from "@/components/projects/EditProjectDialog";
import { notifyTrackerProjectsChanged } from "@/lib/projectEvents";
import { PROJECTS_PATH, workspaceBasePath } from "@/lib/workspaceRoutes";
import { getProject } from "@/services/projects";
import type { Project } from "@/types/project";

export function EditProjectRoute() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const slug = projectSlug.trim();

  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!slug) {
      navigate(PROJECTS_PATH, { replace: true });
      return;
    }

    let active = true;
    void getProject(slug)
      .then((loaded) => {
        if (active) setProject(loaded);
      })
      .catch((cause) => {
        if (!active) return;
        toast.error(cause instanceof Error ? cause.message : "Unable to load project");
        navigate({ pathname: PROJECTS_PATH, search: location.search }, { replace: true });
      });

    return () => {
      active = false;
    };
  }, [slug, navigate, location.search]);

  if (!project) return null;

  return (
    <EditProjectDialog
      project={project}
      open
      onOpenChange={(open) => {
        if (!open) navigate({ pathname: PROJECTS_PATH, search: location.search });
      }}
      onSaved={(updated) => {
        notifyTrackerProjectsChanged();
        navigate(workspaceBasePath(updated.slug, "board"));
      }}
    />
  );
}
