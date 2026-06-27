import { Check, ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TRACKER_PROJECTS_CHANGED_EVENT } from "@/lib/projectEvents";
import { cn } from "@/lib/utils";
import { projectSectionFromPathname, projectSectionPath } from "@/lib/workspaceRoutes";
import { listProjects } from "@/services/projects";
import type { Project } from "@/types/project";

interface ProjectSwitcherProps {
  projectSlug: string;
  title?: string;
}

interface SwitcherEntry {
  slug: string;
  name: string;
}

/**
 * Discreet project selector that replaces the static project identity in the
 * header. Picking a project keeps the user on the current workspace section
 * (board/list/kb/assistant/settings) rather than bouncing back to the board.
 */
export function ProjectSwitcher({ projectSlug, title }: ProjectSwitcherProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const loadProjects = useCallback(() => {
    setLoading(true);
    void listProjects()
      .then((items) => {
        setProjects(items);
        loadedRef.current = true;
      })
      .catch(() => {
        // Keep the current project as the sole fallback option on failure.
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Refresh the cached list when projects change elsewhere (create/archive),
  // but only after it has been opened at least once to avoid eager fetches.
  useEffect(() => {
    const handleProjectsChanged = () => {
      if (loadedRef.current) loadProjects();
    };
    window.addEventListener(TRACKER_PROJECTS_CHANGED_EVENT, handleProjectsChanged);
    return () => window.removeEventListener(TRACKER_PROJECTS_CHANGED_EVENT, handleProjectsChanged);
  }, [loadProjects]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next && !loadedRef.current) loadProjects();
    },
    [loadProjects],
  );

  const handleSelect = useCallback(
    (nextSlug: string) => {
      if (nextSlug === projectSlug) return;
      const section = projectSectionFromPathname(location.pathname);
      navigate(projectSectionPath(nextSlug, section));
    },
    [navigate, location.pathname, projectSlug],
  );

  // Always surface the current project, even before the list resolves or when
  // the request fails, so the menu is never empty for the active workspace.
  const entries = useMemo<SwitcherEntry[]>(() => {
    const mapped = projects.map((project) => ({ slug: project.slug, name: project.name }));
    if (mapped.some((entry) => entry.slug === projectSlug)) return mapped;
    return [{ slug: projectSlug, name: title ?? projectSlug }, ...mapped];
  }, [projects, projectSlug, title]);

  const switchLabel = t("layout.projectHeader.switchProject");

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        className="group flex max-w-[16rem] items-center gap-1.5 rounded-md px-2 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={switchLabel}
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold leading-tight">{title ?? projectSlug}</span>
          <span className="block truncate text-xs leading-tight text-muted-foreground">{projectSlug}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100 group-data-[state=open]:opacity-100" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {switchLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && entries.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("layout.projectHeader.loadingProjects")}</div>
        ) : null}
        <div className="max-h-72 overflow-y-auto">
          {entries.map((entry) => {
            const active = entry.slug === projectSlug;
            return (
              <DropdownMenuItem
                key={entry.slug}
                className="gap-2"
                onSelect={() => handleSelect(entry.slug)}
              >
                <Check className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{entry.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{entry.slug}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
