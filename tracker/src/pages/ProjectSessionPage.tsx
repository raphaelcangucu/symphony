import { Navigate, useParams } from "react-router-dom";

import { ProjectSessionsWorkspace } from "@/components/sessions/ProjectSessionsWorkspace";

function parseThreadId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function ProjectSessionPage() {
  const { projectSlug = "", threadId } = useParams();
  const parsedThreadId = parseThreadId(threadId);

  if (!projectSlug.trim()) return <Navigate to="/projects" replace />;
  if (!parsedThreadId) return <Navigate to={`/projects/${projectSlug}/sessions`} replace />;

  return (
    <ProjectSessionsWorkspace
      key={projectSlug}
      projectSlug={projectSlug}
      activeThreadId={parsedThreadId}
    />
  );
}
