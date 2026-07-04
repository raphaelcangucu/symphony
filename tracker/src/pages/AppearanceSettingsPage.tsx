import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTrackerTheme } from "@/hooks/useTrackerTheme";
import { cn } from "@/lib/utils";
import type { SettingsIcon } from "@/lib/settingsAgents";
import type { Theme } from "@/lib/trackerTheme";

const THEME_OPTIONS: { value: Theme; labelKey: string; icon: SettingsIcon }[] = [
  { value: "light", labelKey: "nav.theme.light", icon: Sun },
  { value: "dark", labelKey: "nav.theme.dark", icon: Moon },
  { value: "system", labelKey: "nav.theme.system", icon: Monitor },
];

export function AppearanceSettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTrackerTheme();

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("settings.sections.appearance.label")}
        description={t("settings.appearance.description")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance.theme.title")}</CardTitle>
          <CardDescription>{t("settings.appearance.theme.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("settings.appearance.theme.title")}>
            {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
