import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { NativeSelect } from "@/components/ui/native-select";
import { SETTINGS_NAV_GROUPS } from "@/lib/settingsNav";
import { cn } from "@/lib/utils";

export function SettingsLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationItems = SETTINGS_NAV_GROUPS.flatMap((group) => group.items);
  const activePath =
    navigationItems
      .filter(
        (item) =>
          location.pathname === item.to ||
          (!item.end && location.pathname.startsWith(`${item.to}/`)),
      )
      .sort((left, right) => right.to.length - left.to.length)[0]?.to ??
    "/settings";

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="settings-scroll-container"
    >
      <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-6 lg:gap-10">
        <div className="sticky top-0 z-20 -mx-4 -mt-4 border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <NativeSelect
            aria-label={t("settings.navLabel")}
            value={activePath}
            onChange={(event) => void navigate(event.target.value)}
          >
            {SETTINGS_NAV_GROUPS.map((group) => (
              <optgroup key={group.id} label={t(group.labelKey)}>
                {group.items.map((item) => (
                  <option key={item.to} value={item.to}>
                    {t(item.labelKey)}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </div>

        <nav
          aria-label={t("settings.navLabel")}
          className="hidden flex-col gap-5 md:sticky md:top-6 md:flex md:self-start"
        >
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {t(group.labelKey)}
              </p>
              {group.items.map(
                ({ to, labelKey, icon: Icon, end, badgeKey }) => (
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
                    <span className="min-w-0 flex-1 truncate">
                      {t(labelKey)}
                    </span>
                    {badgeKey ? (
                      <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t(badgeKey)}
                      </span>
                    ) : null}
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="min-w-0 pb-4 md:pb-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
