import { HardDrive, FlaskConical, LayoutTemplate, MessagesSquare, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import { settingsBackupsPath, settingsGatewaysPath, settingsLabPath, settingsPath, settingsTemplatesPath } from "@/lib/settingsRoutes";
import { cn } from "@/lib/utils";

type SettingsNavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
};

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { to: settingsPath(), labelKey: "settings.sections.general.label", icon: SlidersHorizontal, end: true },
  { to: settingsLabPath(), labelKey: "settings.sections.lab.label", icon: FlaskConical },
  { to: settingsTemplatesPath(), labelKey: "settings.sections.templates.label", icon: LayoutTemplate },
  { to: settingsBackupsPath(), labelKey: "settings.sections.backups.label", icon: HardDrive },
  { to: settingsGatewaysPath(), labelKey: "settings.sections.gateways.label", icon: MessagesSquare },
];

export function SettingsLayout() {
  const { t } = useTranslation();

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-6 p-6 md:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <nav
          aria-label={t("settings.navLabel")}
          className="flex flex-col gap-1 md:sticky md:top-6 md:self-start"
        >
          {SETTINGS_NAV_ITEMS.map(({ to, labelKey, icon: Icon, end }) => {
            const label = t(labelKey);
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
                    isActive && "bg-accent text-accent-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </NavLink>
            );
          })}
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
