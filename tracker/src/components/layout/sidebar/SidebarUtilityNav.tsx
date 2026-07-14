import { Bot, Plus, Search, Settings } from "lucide-react";
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
    "h-8 w-full justify-start gap-2 px-2 text-xs font-normal text-muted-foreground";
  const shortcut = searchShortcutLabel();

  return (
    <nav
      aria-label={t("layout.sidebar.utility.label")}
      className={cn("grid gap-0.5", className)}
    >
      <Button type="button" variant="ghost" className={actionClass} onClick={onNewSession}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        <span>{t("layout.sidebar.utility.newSession")}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={actionClass}
        aria-label={t("layout.sidebar.utility.search")}
        onClick={onSearch}
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        <span>{t("layout.sidebar.utility.search")}</span>
        <kbd className="ml-auto rounded border px-1 text-[10px] leading-4 opacity-70">
          {shortcut}
        </kbd>
      </Button>
      <Button asChild variant="ghost" className={actionClass}>
        <Link to="/settings/templates">
          <Bot className="h-3.5 w-3.5" aria-hidden />
          <span>{t("layout.sidebar.utility.automations")}</span>
        </Link>
      </Button>
      <Button asChild variant="ghost" className={actionClass}>
        <Link to="/settings">
          <Settings className="h-3.5 w-3.5" aria-hidden />
          <span>{t("layout.sidebar.utility.settings")}</span>
        </Link>
      </Button>
    </nav>
  );
}
