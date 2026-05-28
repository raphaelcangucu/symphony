import { useEffect, useState } from "react";
import { toast } from "sonner";
import { discoverGitHubProjects, type GitHubProjectSummary } from "@/services/remoteTrackers";

interface GitHubProjectPickerProps {
  onSelect: (project: GitHubProjectSummary) => void;
}

export function GitHubProjectPicker({ onSelect }: GitHubProjectPickerProps) {
  const [projects, setProjects] = useState<GitHubProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    discoverGitHubProjects()
      .then((items) => active && setProjects(items))
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : "Failed to load GitHub projects"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading GitHub projects…</p>;
  if (projects.length === 0) return <p className="text-sm text-muted-foreground">No GitHub Projects v2 boards found.</p>;

  return (
    <div className="grid gap-2">
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          onClick={() => onSelect(project)}
          className="rounded-md border p-3 text-left transition hover:bg-muted/50"
        >
          <span className="block text-sm font-medium">{project.title}</span>
          <span className="block text-xs text-muted-foreground">
            {project.owner.login} · #{project.number}
          </span>
        </button>
      ))}
    </div>
  );
}
