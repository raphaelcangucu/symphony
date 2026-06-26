import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { KbWorkspace, type KbWorkspaceRouter } from "@/components/kb/KbWorkspace";
import { kbPagePath, kbRepoPath } from "@/lib/kbRoutes";

function parseSplat(splat: string): { repoSlug: string | null; pagePath: string | null } {
  const segments = splat.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return { repoSlug: null, pagePath: null };
  return {
    repoSlug: segments[0],
    pagePath: segments.length > 1 ? segments.slice(1).join("/") : null,
  };
}

export function KbProjectPage() {
  const params = useParams();
  const projectSlug = params.projectSlug ?? "";
  const { repoSlug, pagePath } = parseSplat(params["*"] ?? "");

  const router = useMemo<KbWorkspaceRouter>(
    () => ({
      page: (repo, path) => kbPagePath(projectSlug, repo, path),
      repo: (repo) => kbRepoPath(projectSlug, repo),
    }),
    [projectSlug],
  );

  return (
    <KbWorkspace projectSlug={projectSlug} repoSlug={repoSlug} pagePath={pagePath} router={router} />
  );
}
