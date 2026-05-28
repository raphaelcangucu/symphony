import { FolderKanban } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { IssueDrawer } from "@/components/issues/IssueDrawer";
import { ProjectHeader } from "@/components/layout/ProjectHeader";
import { ListView } from "@/components/list/ListView";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIssueBoard } from "@/hooks/useIssueBoard";
import { listProjects } from "@/services/projects";
import type { Issue } from "@/types/issue";
import type { Project } from "@/types/project";

function ProjectsIndexPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listProjects().then((items) => {
      if (active) setProjects(items);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">Choose a local tracker project.</p>
      </div>
      {loading ? <Skeleton className="h-40" /> : null}
      {!loading && projects.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">No projects returned by the tracker API.</div> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <Link key={project.slug} to={`/projects/${project.slug}/board`}>
            <Card className="h-full transition hover:border-primary/30 hover:shadow-md">
              <CardHeader>
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <FolderKanban className="h-4 w-4" />
                </div>
                <CardTitle>{project.name}</CardTitle>
                <CardDescription>{project.description || project.slug}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{project.issueCount ?? 0} issues</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ProjectListPage() {
  const { projectSlug } = useParams();
  const slug = projectSlug ?? "";
  const { issues, loading, error, setIssues } = useIssueBoard(slug);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  if (!projectSlug) return <ProjectsIndexPage />;

  return (
    <div className="min-h-screen">
      <ProjectHeader projectSlug={projectSlug} onIssueCreated={(issue) => setIssues((current) => [...current, issue])} />
      <div className="p-6">
        {loading ? <Skeleton className="h-72" /> : null}
        {error ? <div className="mb-4 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div> : null}
        {!loading ? <ListView issues={issues} onSelectIssue={setSelectedIssue} /> : null}
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
  );
}
