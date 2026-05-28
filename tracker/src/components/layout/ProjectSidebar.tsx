import { FolderKanban, KeyRound, ListTodo } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clearTrackerToken } from "@/config";
import { cn } from "@/lib/utils";
import { listProjects } from "@/services/projects";
import type { Project } from "@/types/project";

export function ProjectSidebar() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void listProjects()
      .then((items) => {
        if (active) setProjects(items);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <aside className="hidden h-screen w-72 shrink-0 flex-col border-r bg-muted/20 p-4 md:flex">
      <div className="mb-6 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <FolderKanban className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">Symphony Tracker</div>
          <div className="text-xs text-muted-foreground">Local project board</div>
        </div>
      </div>

      <NavLink
        to="/projects"
        className={({ isActive }) =>
          cn(
            "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            isActive && "bg-accent text-foreground",
          )
        }
      >
        <ListTodo className="h-4 w-4" />
        Projects
      </NavLink>

      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Boards</div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">
        {loading ? (
          <>
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </>
        ) : null}
        {!loading && projects.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No local projects yet.</div>
        ) : null}
        {projects.map((project) => (
          <NavLink
            key={project.slug}
            to={`/projects/${project.slug}/board`}
            className={({ isActive }) =>
              cn(
                "block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                isActive && "bg-accent text-foreground",
              )
            }
          >
            <div className="truncate font-medium">{project.name}</div>
            <div className="truncate text-xs opacity-70">{project.slug}</div>
          </NavLink>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start text-muted-foreground"
          onClick={() => {
            clearTrackerToken();
            window.location.assign("/token");
          }}
        >
          <KeyRound className="h-4 w-4" />
          Reset token
        </Button>
      </div>
    </aside>
  );
}
