import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import { SETTINGS_NAV_GROUPS } from "@/lib/settingsNav";
import { cn } from "@/lib/utils";

export function SettingsLayout() {
  const { t } = useTranslation();

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-6 p-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <nav
          aria-label={t("settings.navLabel")}
          className="flex flex-col gap-5 md:sticky md:top-6 md:self-start"
        >
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {t(group.labelKey)}
              </p>
              {group.items.map(({ to, labelKey, icon: Icon, end, badgeKey }) => (
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
                  <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                  {badgeKey ? (
                    <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t(badgeKey)}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
