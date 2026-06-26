import {
  Activity,
  BookOpen,
  HardDrive,
  KeyRound,
  type LucideIcon,
  LayoutTemplate,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

const TRACKER_BRAND_ICON_ALT_KEY = "nav.brandIconAlt";
const TRACKER_BRAND_ICON_SRC = resolveTrackerAssetPath(import.meta.env.BASE_URL, "favicon.svg");

export const TRACKER_SIDEBAR_COLLAPSED_STORAGE_KEY = "tracker-sidebar-collapsed";

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/projects", labelKey: "nav.projects", icon: ListTodo },
  { to: "/kb", labelKey: "nav.knowledgeBase", icon: BookOpen },
  { to: "/templates", labelKey: "nav.templates", icon: LayoutTemplate },
  { to: "/observability", labelKey: "nav.observability", icon: Activity },
  { to: "/backups", labelKey: "nav.backups", icon: HardDrive },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

export function resolveTrackerAssetPath(baseUrl: string, assetName: string): string {
  const normalizedAssetName = assetName.replace(/^\/+/, "");
  if (normalizedAssetName.length === 0) {
    throw new Error("Tracker asset name must not be empty");
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}${normalizedAssetName}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredCollapsed(): boolean {
  const storage = getStorage();
  if (!storage) return false;

  try {
    return storage.getItem(TRACKER_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredCollapsed(collapsed: boolean) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(TRACKER_SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Collapse preference should never block the rest of the Tracker UI.
  }
}

export function ProjectSidebar() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed());
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

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      writeStoredCollapsed(next);
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 flex-col border-r bg-muted/20 transition-[width] duration-200 md:flex",
        collapsed ? "w-16 p-2" : "w-72 p-4",
      )}
    >
      <div className={cn("mb-6 flex items-center gap-2", collapsed && "flex-col gap-3")}>
        <img
          src={TRACKER_BRAND_ICON_SRC}
          alt={t(TRACKER_BRAND_ICON_ALT_KEY)}
          className="h-9 w-9 rounded-lg shadow-sm"
          decoding="async"
        />
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{t("nav.brandTitle")}</div>
            <div className="truncate text-xs text-muted-foreground">{t("nav.brandSubtitle")}</div>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          aria-expanded={!collapsed}
          title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          onClick={toggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => {
        const label = t(labelKey);
        return (
        <NavLink
          key={to}
          to={to}
          title={collapsed ? label : undefined}
          className={({ isActive }) =>
            cn(
              "mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
              collapsed && "justify-center px-0",
              isActive && "bg-accent text-foreground",
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {collapsed ? <span className="sr-only">{label}</span> : label}
        </NavLink>
        );
      })}

      {collapsed ? null : <RecentsSection />}

      {collapsed ? null : (
        <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("nav.boards")}</div>
      )}
      <div className={cn("min-h-0 flex-1 space-y-1 overflow-auto", collapsed && "mt-1")}>
        {loading ? (
          <>
            <Skeleton className={cn("h-9", collapsed && "w-full")} />
            <Skeleton className={cn("h-9", collapsed && "w-full")} />
          </>
        ) : null}
        {!loading && projects.length === 0 && !collapsed ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("nav.noProjects")}</div>
        ) : null}
        {projects.map((project) => (
          <NavLink
            key={project.slug}
            to={`/projects/${project.slug}/board`}
            title={collapsed ? project.name : undefined}
            className={({ isActive }) =>
              cn(
                "block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                collapsed && "flex items-center justify-center px-0",
                isActive && "bg-accent text-foreground",
              )
            }
          >
            {collapsed ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-md border text-sm font-semibold uppercase">
                {project.name.charAt(0)}
                <span className="sr-only">{project.name}</span>
              </span>
            ) : (
              <>
                <div className="truncate font-medium">{project.name}</div>
                <div className="truncate text-xs opacity-70">{project.slug}</div>
              </>
            )}
          </NavLink>
        ))}
      </div>

      <div className={cn("mt-4 flex items-center gap-2", collapsed && "flex-col")}>
        <ThemeToggle />
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label={t("nav.resetToken")}
            title={t("nav.resetToken")}
            onClick={() => {
              clearTrackerToken();
              window.location.assign("/token");
            }}
          >
            <KeyRound className="h-4 w-4" />
          </Button>
        ) : (
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
            {t("nav.resetToken")}
          </Button>
        )}
      </div>
    </aside>
  );
}
