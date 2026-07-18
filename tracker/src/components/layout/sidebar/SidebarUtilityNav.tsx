import { Activity, Container, Plus, Search, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SidebarUtilityNavProps {
  readonly onNewSession: () => void;
  readonly onSearch: () => void;
  readonly className?: string;
}

function searchShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+K";
  const platform = navigator.platform ?? "";
  const isApple = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isApple ? "⌘K" : "Ctrl+K";
}

export function SidebarUtilityNav({
  onNewSession,
  onSearch,
  className,
}: SidebarUtilityNavProps) {
  const { t } = useTranslation();
  const actionClass =
    "h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm font-normal text-foreground/80 hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]";
  const shortcut = searchShortcutLabel();

  return (
    <nav
      aria-label={t("layout.sidebar.utility.label")}
      className={cn("grid gap-1", className)}
    >
      <Button type="button" variant="ghost" className={actionClass} onClick={onNewSession}>
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t("layout.sidebar.utility.newSession")}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={actionClass}
        aria-label={t("layout.sidebar.utility.search")}
        onClick={onSearch}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t("layout.sidebar.utility.search")}</span>
        <kbd className="ml-auto rounded-md border bg-background/80 px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground">
          {shortcut}
        </kbd>
      </Button>
      <Button asChild variant="ghost" className={actionClass}>
        <Link to="/observability">
          <Activity className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("nav.observability")}</span>
        </Link>
      </Button>
      <Button asChild variant="ghost" className={actionClass}>
        <Link to="/docker">
          <Container className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("nav.docker")}</span>
        </Link>
      </Button>
      <Button asChild variant="ghost" className={actionClass}>
        <Link to="/settings">
          <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{t("layout.sidebar.utility.settings")}</span>
        </Link>
      </Button>
    </nav>
  );
}
