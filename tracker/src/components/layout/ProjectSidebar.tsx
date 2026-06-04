import { Activity, HardDrive, KeyRound, LayoutTemplate, ListTodo } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import { RecentsSection } from "@/components/layout/RecentsSection";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clearTrackerToken } from "@/config";
import { TRACKER_PROJECTS_CHANGED_EVENT } from "@/lib/projectEvents";
import { cn } from "@/lib/utils";
import { listProjects } from "@/services/projects";
import type { Project } from "@/types/project";

const TRACKER_BRAND_ICON_ALT = "Symphony Tracker icon";
const TRACKER_BRAND_ICON_SRC = resolveTrackerAssetPath(import.meta.env.BASE_URL, "favicon.svg");

export function resolveTrackerAssetPath(baseUrl: string, assetName: string): string {
  const normalizedAssetName = assetName.replace(/^\/+/, "");
  if (normalizedAssetName.length === 0) {
    throw new Error("Tracker asset name must not be empty");
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}${normalizedAssetName}`;
}

export function ProjectSidebar() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    const loadActiveProjects = () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const isCurrentRequest = () => active && requestId === requestIdRef.current;

      void listProjects()
        .then((items) => {
          if (isCurrentRequest()) setProjects(items);
        })
        .finally(() => {
          if (isCurrentRequest()) setLoading(false);
        });
    };

    loadActiveProjects();
    window.addEventListener(TRACKER_PROJECTS_CHANGED_EVENT, loadActiveProjects);

    return () => {
      active = false;
      window.removeEventListener(TRACKER_PROJECTS_CHANGED_EVENT, loadActiveProjects);
    };
  }, []);

  return (
    <aside className="hidden h-screen w-72 shrink-0 flex-col border-r bg-muted/20 p-4 md:flex">
      <div className="mb-6 flex items-center gap-2">
        <img
          src={TRACKER_BRAND_ICON_SRC}
          alt={TRACKER_BRAND_ICON_ALT}
          className="h-9 w-9 rounded-lg shadow-sm"
          decoding="async"
        />
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

      <NavLink
        to="/templates"
        className={({ isActive }) =>
          cn(
            "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            isActive && "bg-accent text-foreground",
          )
        }
      >
        <LayoutTemplate className="h-4 w-4" />
        Templates
      </NavLink>

      <NavLink
        to="/observability"
        className={({ isActive }) =>
          cn(
            "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            isActive && "bg-accent text-foreground",
          )
        }
      >
        <Activity className="h-4 w-4" />
        Observability
      </NavLink>

      <NavLink
        to="/backups"
        className={({ isActive }) =>
          cn(
            "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
            isActive && "bg-accent text-foreground",
          )
        }
      >
        <HardDrive className="h-4 w-4" />
        Backups
      </NavLink>

      <RecentsSection />

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
